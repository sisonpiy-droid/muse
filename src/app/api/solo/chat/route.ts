import { z } from "zod";

import { getProvider, userFacingError } from "@/lib/ai";
import { buildMuseSystemPrompt } from "@/lib/muse/prompt";
import { personaSystem } from "@/lib/presence/persona";

/* Solo mode's only server dependency.
 *
 * Entirely stateless: no database, no session, no storage. The client holds the
 * conversation and the memories and sends what it wants used; this route builds
 * the prompt and streams a reply.
 *
 * It exists at all because the model API key must stay server-side (§50). A
 * fully static build would have to ship the key to the browser, which is not a
 * tradeoff worth making for the convenience of skipping one function.
 *
 * The system prompt is still assembled here, never sent by the client (§33) --
 * otherwise anyone could point this endpoint at any instructions they liked.
 */

export const runtime = "nodejs";

/* Replies stream, so the connection is held for the whole generation. */
export const maxDuration = 60;

const bodySchema = z.object({
  muse: z.object({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(400),
    relationshipType: z.string().trim().min(1).max(40),
    languages: z.array(z.string().max(40)).max(5).default(["English"]),
    personality: z
      .object({
        traits: z.array(z.string().max(30)).max(8).default([]),
        values: z.string().max(300).nullish(),
        humour: z.string().max(300).nullish(),
        emotionalStyle: z.string().max(300).nullish(),
        opinions: z.string().max(500).nullish(),
        customInstructions: z.string().max(600).nullish(),
        tone: z.string().max(80).nullish(),
        formality: z.string().max(40).nullish(),
        vocabulary: z.string().max(80).nullish(),
        sentenceLength: z.string().max(40).nullish(),
        catchphrases: z.string().max(200).nullish(),
        dialect: z.string().max(80).nullish(),
      })
      .nullish(),
  }),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(60),
  /* Someone built from real material sends Presence's whole profile. When it is
     present it decides the prompt entirely -- the archetype, texture and mode
     blocks are the reason that build sounds like the person rather than like an
     assistant wearing their name. */
  persona: z
    .object({
      them: z.string().max(60),
      you: z.string().max(60),
      relationship: z.string().max(120).default(""),
      callsYou: z.string().max(60).optional(),
      arch: z.string().max(30).default("other"),
      texture: z.string().max(30).default("close"),
      mode: z.string().max(30).default("memorial"),
      samples: z.string().max(14000).optional(),
      extra: z.string().max(4000).optional(),
      metrics: z.string().max(4000).optional(),
      brief: z.string().max(6000).optional(),
    })
    .nullish(),
  register: z.string().max(20).optional(),
  memories: z.array(z.string().max(400)).max(12).default([]),
  userName: z.string().trim().max(80).nullish(),
  timezone: z.string().max(64).nullish(),
});

/* Input bounds matter more here than in the signed-in app: there is no account
   to rate-limit against, so size is the only thing keeping one caller from
   running up the bill (§53). */
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
  const { muse, persona, register, messages, memories, userName, timezone } = parsed.data;

  const total = messages.reduce((n, m) => n + m.content.length, 0)
    + memories.reduce((n, m) => n + m.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return Response.json({ error: "This conversation has got too long to send." }, { status: 413 });
  }

  const system = persona
    ? personaSystem(persona, memories, false, {
        mood: "any",
        topic: "any",
        register: register || "texts",
      })
    : buildMuseSystemPrompt({
    name: muse.name,
    description: muse.description,
    relationshipType: muse.relationshipType,
    languages: muse.languages,
    personality: muse.personality
      ? {
          traits: muse.personality.traits,
          values: muse.personality.values ?? null,
          humour: muse.personality.humour ?? null,
          emotionalStyle: muse.personality.emotionalStyle ?? null,
          opinions: muse.personality.opinions ?? null,
          customInstructions: muse.personality.customInstructions ?? null,
          tone: muse.personality.tone ?? null,
          formality: muse.personality.formality ?? null,
          vocabulary: muse.personality.vocabulary ?? null,
          sentenceLength: muse.personality.sentenceLength ?? null,
          catchphrases: muse.personality.catchphrases ?? null,
          dialect: muse.personality.dialect ?? null,
        }
      : null,
    userName: userName ?? null,
    memories,
    localTime: new Date(),
    timezone: timezone ?? undefined,
      });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const delta of getProvider().streamResponse({ system, messages })) {
          send({ type: "delta", text: delta });
        }
        send({ type: "done" });
      } catch (err) {
        console.error("solo generation failed", err);
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
