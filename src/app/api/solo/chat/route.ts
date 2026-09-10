import { z } from "zod";

import { streamGuarded, userFacingError } from "@/lib/ai";
import { looksLikeRefusal } from "@/lib/ai/refusal";
import { buildMuseSystemPrompt } from "@/lib/muse/prompt";
import { personaSystem, type Feelings } from "@/lib/presence/persona";

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
  /* People this Muse shares a circle with. Additive: absent on every request
     that does not involve circles, and the prompt is unchanged when it is. */
  knows: z
    .array(z.object({ name: z.string().max(60), relationship: z.string().max(120) }))
    .max(8)
    .optional(),
  mood: z.string().max(20).optional(),
  topic: z.string().max(20).optional(),
  register: z.string().max(20).optional(),
  /* Standing emotional state. Separate from `mood` above, which is this
     conversation only -- this one persists and the user sets it rarely. */
  feelings: z
    .object({
      mood: z.string().max(20).default("any"),
      warmth: z.string().max(20).default("normal"),
      note: z.string().max(600).default(""),
    })
    .nullish(),
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
  const { muse, persona, knows, mood, topic, register, feelings, messages, memories, userName, timezone } =
    parsed.data;

  const standing: Feelings | undefined = feelings ?? undefined;

  /* Drop the model's own past refusals from the history. Once "I cannot
     roleplay this persona" is in the transcript the model continues in that
     voice, so a thread that broke once stays broken -- and the owner has no way
     to know why. Removing them here means an already-poisoned conversation
     recovers on its next message instead of needing to be deleted. */
  const cleaned = messages.filter(
    (m) => !(m.role === "assistant" && looksLikeRefusal(m.content))
  );
  const messagesForModel = cleaned.length ? cleaned : messages;

  const total = messages.reduce((n, m) => n + m.content.length, 0)
    + memories.reduce((n, m) => n + m.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return Response.json({ error: "This conversation has got too long to send." }, { status: 413 });
  }

  const system = persona
    ? personaSystem(persona, memories, false, {
        mood: mood || "any",
        topic: topic || "any",
        register: register || "texts",
      }, timezone ?? undefined, standing) +
      (knows?.length
        ? `

PEOPLE YOU BOTH KNOW
${knows
            .map((k) => `- ${k.name}, ${userName || "their"} ${k.relationship}`)
            .join("\n")}
You may mention them, ask after them, or have opinions about them. Do not invent what they have been doing lately -- you would only know that if you had been told.`
        : "")
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

  /* Progressively less of the real message data, for when the provider will not
     accept the full profile.
     
     This ladder exists because of a reported failure that no retry could fix:
     Gemini returned blockReason PROHIBITED_CONTENT on every attempt for a
     persona built from a couple's chat export. That block is not the
     configurable safety classifier -- safetySettings govern blockReason SAFETY,
     and no threshold, BLOCK_NONE included, switches PROHIBITED_CONTENT off. The
     only lever left is to send less verbatim material.
     
     The previous fallback trimmed samples to 500 characters and kept everything
     else, which was barely a step down and got blocked exactly like the full
     prompt did. So: first drop the measured statistics and the user's notes and
     cut the samples hard, then drop the samples entirely and run on the brief
     alone. A blander version of someone is worth having. Silence is not. */
  const variant = (p: NonNullable<typeof persona>) =>
    personaSystem(
      p,
      memories,
      false,
      { mood: mood || "any", topic: topic || "any", register: register || "texts" },
      timezone ?? undefined,
      standing
    );

  const bare = { ...persona, samples: undefined, metrics: undefined, extra: undefined };

  const fallbacks = persona
    ? [
        variant({ ...persona, samples: persona.samples?.slice(0, 300), metrics: undefined, extra: undefined }),
        variant(bare as NonNullable<typeof persona>),
        /* Last rung. The relationship blocks are written material too, and the
           partner one is the most loaded thing in the prompt for a persona
           built from a couple's messages -- it talks about missing someone's
           hands and being shameless with them, which is fine in a companion app
           and is exactly the shape a classifier reacts to. "other" drops the
           relationship script entirely and leans on the brief. Whoever this is
           still has their name, their voice profile and their memories; what
           they lose is the archetype colouring. */
        variant({ ...bare, arch: "other", texture: "close" } as NonNullable<typeof persona>),
      ]
    : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        /* A refusal never reaches the client, so it can never be saved into the
           transcript and poison every turn after it. */
        for await (const evt of streamGuarded({
          system,
          fallbacks,
          messages: messagesForModel,
          name: persona?.them ?? muse.name,
        })) {
          if (evt.type === "delta") send({ type: "delta", text: evt.text });
          else if (evt.type === "refused") {
            const who = persona?.them ?? muse.name;
            /* The old wording here blamed the last message and told the user
               to reword it. On the reported case that was "hi", so they
               reworded it several times and got the same wall. A prompt-level
               block is about the saved profile, and now that the profile is
               editable, saying so is something they can act on. */
            send({
              type: "error",
              message:
                evt.reason === "blocked"
                  ? `Google's content filter is refusing ${who}'s saved profile, so nothing can be sent. It isn't what you wrote. Open edit and cut down the sample messages — that usually clears it.`
                  : `${who} didn't come to the phone. Try saying it differently.`,
              retryable: evt.reason !== "blocked",
            });
          } else send({ type: "done" });
        }
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
