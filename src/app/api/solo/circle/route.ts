import { z } from "zod";

import { streamGuarded, userFacingError } from "@/lib/ai";
import { circleBlock, circleHistory, personaSystem } from "@/lib/presence/persona";

/* One turn in a circle: several people in a room, one of them replying.
 *
 * A separate route from /api/solo/chat on purpose. The one-to-one path works
 * and is what almost every conversation uses; bolting a second mode into it
 * would put a branch through the middle of the thing that already works.
 *
 * The prompt is the member's own personaSystem output plus a circle block. So
 * whoever is speaking is exactly who they are one to one, in a room with
 * others -- not a different character who happens to share a name.
 *
 * Stateless, like everything else in solo mode.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const personaSchema = z.object({
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
});

const bodySchema = z.object({
  circleName: z.string().trim().min(1).max(60),
  /** The member being asked to speak. */
  speaker: z.object({ id: z.string().max(60), persona: personaSchema }),
  /** Everyone else in the room, for the roster. */
  others: z
    .array(z.object({ id: z.string().max(60), name: z.string().max(60), relationship: z.string().max(120) }))
    .max(7),
  log: z
    .array(
      z.object({
        from: z.enum(["user", "muse"]),
        speakerId: z.string().max(60).optional(),
        content: z.string().min(1).max(8000),
      })
    )
    .min(1)
    .max(80),
  /** Maps a speakerId to a display name, so the transcript reads as a room. */
  names: z.record(z.string(), z.string().max(60)),
  userName: z.string().trim().max(80).nullish(),
  timezone: z.string().max(64).nullish(),
  mood: z.string().max(20).optional(),
  register: z.string().max(20).optional(),
  /* Whoever is speaking brings their own standing state into the room. Keyed
     by speaker rather than shared: one person can be having a bad month while
     everyone else is fine, which is most group chats. */
  feelings: z
    .object({
      mood: z.string().max(20).default("any"),
      warmth: z.string().max(20).default("normal"),
      note: z.string().max(600).default(""),
    })
    .nullish(),
});

const MAX_TOTAL_CHARS = 60_000;

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Check the request and try again." }, { status: 400 });
  }
  const { circleName, speaker, others, log, names, userName, timezone, mood, register, feelings } =
    parsed.data;

  if (log.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS) {
    return Response.json({ error: "This conversation has got too long to send." }, { status: 413 });
  }

  const you = userName?.trim() || speaker.persona.you || "them";

  const system =
    personaSystem(
      { ...speaker.persona, you },
      [],
      false,
      { mood: mood || "any", topic: "any", register: register || "texts" },
      timezone ?? undefined,
      feelings ?? undefined
    ) + circleBlock({ you, me: speaker.persona.them, others, circleName });

  const messages = circleHistory(log, speaker.id, you, (id) => names[id] ?? "Someone");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const evt of streamGuarded({ system, messages, name: speaker.persona.them })) {
          if (evt.type === "delta") send({ type: "delta", text: evt.text });
          else if (evt.type === "refused") {
            /* In a circle a refusal is quieter: that member simply says
               nothing this turn, which is normal in a group anyway. */
            send({ type: "silent" });
          } else send({ type: "done" });
        }
      } catch (err) {
        console.error("circle generation failed", err);
        const { message, retryable } = userFacingError(err);
        send({ type: "error", message, retryable });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
