import { z } from "zod";

import { getProvider, userFacingError } from "@/lib/ai";
import { ARCHETYPES, MODES, PROMPTS, TEXTURES, briefSystem } from "@/lib/presence/persona";

/* Build a voice profile from real material.
 *
 * This is Presence's build, unchanged: the same brief prompt, the same material
 * assembly, the same ordering. It was tuned against real conversations and it
 * produced characters that sounded like the person rather than like an
 * assistant wearing their name.
 *
 * The browser parses and measures; only the measured habits and a sampled
 * excerpt come here. The rest of the conversation never leaves the device,
 * which matters because a two-person chat contains a second person who agreed
 * to none of this.
 *
 * Stateless. No database, no session.
 */

export const runtime = "nodejs";

/* A real export makes a large prompt and Gemini reasons for several hundred
   tokens before writing. Measured around 13s, close enough to the platform
   default that a bigger chat would be killed mid-generation and arrive as a
   network error with nothing to explain it. */
export const maxDuration = 60;

const bodySchema = z.object({
  them: z.string().trim().min(1).max(60),
  you: z.string().trim().min(1).max(60),
  relationship: z.string().trim().max(120).default(""),
  callsYou: z.string().trim().max(60).optional(),
  arch: z.string().trim().max(30).default("other"),
  texture: z.string().trim().max(30).default("close"),
  mode: z.enum(["memorial", "living", "character"]),
  /** Required for `living`: whether they know and agreed. */
  consent: z.boolean().nullish(),

  samples: z.string().max(14000).optional(),
  extra: z.string().max(4000).optional(),
  metrics: z.string().max(4000).optional(),
  prompts: z.record(z.string(), z.string().max(400)).optional(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Check the details and try again." }, { status: 400 });
  }
  const src = parsed.data;

  /* §35, and Presence's own rule. Refused here as well as in the UI, so the
     check cannot be skipped by calling the endpoint directly. */
  if (src.mode === "living" && src.consent !== true) {
    return Response.json(
      {
        error:
          "Someone still living can object to a version of themselves, and this one would be built entirely out of things they said to you privately. Ask them first.",
        code: "consent_required",
      },
      { status: 403 }
    );
  }

  const archLabel = (ARCHETYPES as Record<string, { label: string }>)[src.arch]?.label ?? ARCHETYPES.other.label;
  const texLabel = (TEXTURES as Record<string, { label: string }>)[src.texture]?.label ?? TEXTURES.close.label;
  const modeLabel = (MODES as Record<string, { label: string }>)[src.mode]?.label ?? MODES.memorial.label;

  /* Presence's material block, field for field and in the same order. */
  const material = [
    `Name: ${src.them}`,
    `They were: ${src.relationship}`,
    `Relationship type: ${archLabel}`,
    `This is: ${modeLabel}`,
    `What the relationship was like: ${texLabel}`,
    `Talking to: ${src.you}${src.callsYou ? `, who they called "${src.callsYou}"` : ""}`,
    src.samples?.trim()
      ? `\nSample messages they actually sent:\n${src.samples.trim().slice(0, 4500)}`
      : "\nNo sample messages given.",
    src.extra?.trim()
      ? `\nHow they thought and what they were like, written by the person who knew them:\n${src.extra.trim()}`
      : "",
    src.metrics?.trim()
      ? `\nMeasured statistics from their real message history — treat these as fact:\n${src.metrics.trim()}`
      : "",
    "",
    ...PROMPTS.map((pr) => `${pr.q} ${src.prompts?.[pr.k]?.trim() || "(blank)"}`),
  ].join("\n");

  try {
    /* Presence capped this at 650 tokens against Anthropic, which spends none of
       them reasoning. Gemini 3.x spends 300-1000 before it writes and the cap
       covers both, so a capped brief comes back truncated. Left uncapped. */
    const { text } = await getProvider().generateResponse({
      system: briefSystem(src.mode),
      messages: [{ role: "user", content: material }],
    });

    return Response.json({ brief: text });
  } catch (err) {
    console.error("persona build failed", err);
    const { message } = userFacingError(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
