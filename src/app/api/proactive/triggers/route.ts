import { z } from "zod";

import { prisma } from "@/lib/db";
import { classify, compose } from "@/lib/proactive/compose";
import { deviceId, findDevice } from "@/lib/proactive/device";
import { nextAllowed, planTime, validZone, type TriggerType } from "@/lib/proactive/timing";

/* Memories in, reasons to text out.
 *
 * Called by the app after memory extraction stores something dated or
 * goal-like, for a Muse that is allowed to text first. The persona, the notes
 * and the recent lines arrive with the request, are used to decide and to
 * write, and are not kept: what is stored is the finished message, when to
 * send it, and a few words of why.
 *
 * One trigger per memory, ever -- the database enforces it. Anything the app
 * no longer lists (deleted, replaced by "the interview went fine") has its
 * pending trigger cancelled here.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const persona = z.object({
  them: z.string().max(60),
  you: z.string().max(60),
  relationship: z.string().max(120).default(""),
  callsYou: z.string().max(60).optional(),
  arch: z.string().max(30).default("other"),
  texture: z.string().max(30).default("close"),
  mode: z.string().max(30).default("character"),
  samples: z.string().max(14000).optional(),
  extra: z.string().max(4000).optional(),
  metrics: z.string().max(4000).optional(),
  brief: z.string().max(6000).optional(),
  verbatim: z.boolean().optional(),
  interests: z.string().optional().transform((s) => s?.slice(0, 400)),
  minor: z.boolean().optional(),
  traits: z.array(z.string().max(30)).max(8).optional(),
});

const bodySchema = z.object({
  deviceId,
  muse: z.object({ id: z.string().max(80), name: z.string().max(60) }),
  persona,
  userName: z.string().max(80).nullish(),
  /** Memories worth looking at that have not been looked at before. */
  candidates: z
    .array(z.object({
      id: z.string().max(80),
      content: z.string().max(420),
      type: z.string().max(20),
      at: z.string().max(40).nullish(),
      createdAt: z.string().max(40).optional(),
    }))
    .max(10),
  /** Every memory id that could still justify a trigger; pending ones not listed are cancelled. */
  keep: z.array(z.string().max(80)).max(400),
  recent: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000), at: z.string().max(40).optional() }))
    .max(8)
    .default([]),
});

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;

  const device = await findDevice(body.deviceId);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 404 });
  if (!validZone(device.timezone)) return Response.json({ created: [], evaluated: [] });
  const tz = device.timezone;
  const now = Date.now();

  /* Whatever the app no longer lists has stopped being a reason. */
  await prisma.proactiveTrigger.updateMany({
    where: { deviceId: device.id, museId: body.muse.id, status: "PENDING", sourceMemoryId: { notIn: body.keep } },
    data: { status: "CANCELLED", statusReason: "memory gone or replaced" },
  });

  const existing = new Set(
    (await prisma.proactiveTrigger.findMany({
      where: { deviceId: device.id, sourceMemoryId: { in: body.candidates.map((c) => c.id) } },
      select: { sourceMemoryId: true },
    })).map((t) => t.sourceMemoryId)
  );
  /* A few per request: each is written one at a time, and the rest come back
     on the next sync because they are not reported as evaluated. */
  const fresh = body.candidates.filter((c) => !existing.has(c.id)).slice(0, 4);
  const evaluated = [...existing, ...fresh.map((c) => c.id)];
  if (!fresh.length) return Response.json({ created: [], evaluated });

  let reasons;
  try {
    reasons = await classify(fresh, { now, tz });
  } catch (err) {
    console.error("outreach classify failed", err);
    /* Not evaluated: the app will offer them again next time. */
    return Response.json({ created: [], evaluated: [] });
  }

  const you = body.userName?.trim() || body.persona.you || "them";
  const created: { id: string; sourceMemoryId: string; type: TriggerType; reason: string; scheduledFor: string; keywords: string[] }[] = [];

  /* One at a time, so the same-event check below sees what this batch made. */
  for (const r of reasons) await (async () => {
    const c = fresh.find((x) => x.id === r.id)!;
    /* The memory's own date first; failing that, the date the note states. */
    const stated = c.at ?? r.eventAt;
    const eventAt = stated ? Date.parse(stated) : null;
    const plan = planTime({
      type: r.kind, id: c.id, now, tz,
      eventAt: Number.isFinite(eventAt) ? eventAt : null,
      remindAt: r.remindAt ? Date.parse(r.remindAt) : Number.isFinite(eventAt) ? eventAt : null,
      remindDateOnly: r.dateOnly,
      createdAt: c.createdAt ? Date.parse(c.createdAt) : now,
    });
    if (!plan) return;

    /* One event, one text -- not one per memory of it. Talking about the exam
       again ("don't worry, I've revised") tends to produce a second memory of
       the same exam, and with it a second reason to text about it. A trigger
       already made for an event at about the same moment, whatever became of
       it (including called off because they raised it first), means there is
       nothing new to say. */
    if (eventAt !== null && Number.isFinite(eventAt)) {
      const near = await prisma.proactiveTrigger.count({
        where: {
          deviceId: device.id, museId: body.muse.id,
          eventAt: { gte: new Date(eventAt - 12 * 3600_000), lte: new Date(eventAt + 12 * 3600_000) },
        },
      });
      if (near) return;
    }
    const sendAt = nextAllowed(plan.scheduledFor, tz, device.quietHoursStart, device.quietHoursEnd, c.id);
    if (sendAt >= plan.expiresAt) return;

    let message: string | null = null;
    try {
      message = await compose({
        persona: body.persona, you, tz, kind: r.kind, reason: r.reason, note: c.content,
        sendAt, eventAt: stated ?? null, recent: body.recent,
      });
    } catch (err) {
      console.error("outreach compose failed", err);
    }
    if (!message) return;

    try {
      const t = await prisma.proactiveTrigger.create({
        data: {
          deviceId: device.id, museId: body.muse.id, museName: body.muse.name,
          type: r.kind, reason: r.reason, sourceMemoryId: c.id,
          eventAt: Number.isFinite(eventAt) ? new Date(eventAt!) : null,
          scheduledFor: new Date(sendAt), expiresAt: new Date(plan.expiresAt), message,
        },
      });
      created.push({ id: t.id, sourceMemoryId: c.id, type: r.kind, reason: r.reason, scheduledFor: t.scheduledFor.toISOString(), keywords: r.keywords });
    } catch (err) {
      /* P2002: another request made it first. One per memory either way. */
      if ((err as { code?: string }).code !== "P2002") console.error("outreach trigger save failed", err);
    }
  })();

  return Response.json({ created, evaluated });
}
