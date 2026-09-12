import { z } from "zod";

import { getProvider, userFacingError } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { looksLikeRefusal } from "@/lib/ai/refusal";
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

/** Which field, in the words used on the screen it came from. */
function buildFieldError(field: string, code?: string): string {
  const tooLong = code === "too_big";
  switch (field) {
    case "them":
      return "They need a name.";
    case "you":
      return "Put your own name in as well — it's what they'll call you.";
    case "relationship":
      return tooLong
        ? "“They were” is too long. A few words is enough: “my father”, “my oldest friend”."
        : "Say what they were to you.";
    case "callsYou":
      return "“They called you” is too long — it should be one nickname.";
    case "extra":
      return "What you wrote about them is too long to send. Trim it to a few paragraphs and the rest still comes through in their messages.";
    case "prompts":
      return "One of the five answers is too long. They're meant to be a line each.";
    case "mode":
      return "Pick who this is — someone who died, someone living, or someone you made up.";
    case "samples":
    case "metrics":
      return "That export is larger than this can send in one go. Try a shorter date range.";
    default:
      return "Check the details and try again.";
  }
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    /* "Check the details and try again" is the whole message the user got, on a
       screen with eleven fields, and nothing was written server-side either --
       so a rejected build was undiagnosable from both ends at once. Say which
       field, and log the rest. */
    const issue = parsed.error.issues[0];
    const field = String(issue?.path?.[0] ?? "");
    console.error(
      "persona build rejected:",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join("; ")
    );
    return Response.json({ error: buildFieldError(field, issue?.code) }, { status: 400 });
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

/* Trim the excerpt without throwing away the spread it was chosen for.
 *
 * sampleWindows deliberately samples across the whole history -- 34 windows
 * anchored at even intervals, joined by a separator -- so the profile sees how
 * someone wrote early and late, not just once. The route then took the first
 * 4,500 characters of it, which is the oldest windows and nothing else. Every
 * persona built through this endpoint was a portrait of who that person was at
 * the start of the chat, and nothing said so.
 *
 * Keeping whole windows spread evenly preserves the property the sampler exists
 * for, at the same cost. */
function trimSpread(samples: string, budget: number): string {
  const text = samples.trim();
  if (text.length <= budget) return text;

  const SEP = "\n\n···\n\n";
  const windows = text.split(SEP).filter(Boolean);
  if (windows.length < 2) return text.slice(0, budget);

  /* Walk outward from an even stride so the kept windows stay spread across the
     history rather than clustering at either end. */
  const kept: string[] = [];
  let used = 0;
  const order: number[] = [];
  const stride = Math.max(1, Math.round(windows.length / 12));
  for (let i = 0; i < windows.length; i += stride) order.push(i);
  for (let i = 0; i < windows.length; i++) if (!order.includes(i)) order.push(i);

  const chosen = new Set<number>();
  for (const i of order) {
    const cost = windows[i].length + SEP.length;
    if (used + cost > budget) continue;
    chosen.add(i);
    used += cost;
  }
  for (let i = 0; i < windows.length; i++) if (chosen.has(i)) kept.push(windows[i]);
  return kept.length ? kept.join(SEP) : text.slice(0, budget);
}

  /* Presence's material block, field for field and in the same order. */
  const material = [
    `Name: ${src.them}`,
    `They were: ${src.relationship}`,
    `Relationship type: ${archLabel}`,
    `This is: ${modeLabel}`,
    `What the relationship was like: ${texLabel}`,
    `Talking to: ${src.you}${src.callsYou ? `, who they called "${src.callsYou}"` : ""}`,
    src.samples?.trim()
      ? `\nSample messages they actually sent:\n${trimSpread(src.samples, 4500)}`
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

  /* Less material each time, for when the provider will not take the full set.
   *
   * The chat path grew a fallback ladder because Gemini answers a persona built
   * from a couple's real messages with blockReason PROHIBITED_CONTENT, which no
   * safety threshold disables. The build has exactly the same exposure -- it
   * sends the same private messages, more of them, in one request -- and had no
   * recovery at all: one 502 and the user was returned to a wizard they had
   * just filled in, with no way past it and nothing explaining why. A character
   * that could not be built could never be built.
   *
   * The last rung carries no verbatim messages, which is worse and still a
   * character. The measured statistics survive, so it is still recognisably how
   * that person writes. */
  const ladder = [
    material,
    material.replace(trimSpread(src.samples ?? "", 4500), trimSpread(src.samples ?? "", 1200)),
    material.replace(trimSpread(src.samples ?? "", 4500), "(withheld)"),
  ];

  let lastError: unknown = null;

  for (let i = 0; i < ladder.length; i++) {
    try {
      /* Presence capped this at 650 tokens against Anthropic, which spends none
         of them reasoning. Gemini 3.x spends 300-1000 before it writes and the
         cap covers both, so a capped brief comes back truncated. Left
         uncapped. */
      const { text } = await getProvider().generateResponse({
        system: briefSystem(src.mode),
        messages: [{ role: "user", content: ladder[i] }],
      });

      const brief = (text || "").trim();

      /* A model that declines in words returns 200 with the refusal as its
         text, and that went straight into the profile -- so the character's
         WHO YOU ARE block became "I can't create a profile of a real person",
         which is then what they are for the rest of their life. */
      if (looksLikeRefusal(brief)) {
        console.error(`persona build refused (rung ${i + 1}/${ladder.length}):`, brief.slice(0, 160));
        lastError = new ProviderError("blocked", "refused in words");
        continue;
      }

      /* Too short to be a voice profile. The prompt asks for 180-240 words, so
         anything this small is a truncation or a shrug, and saving it produces
         a character with almost nothing to go on. */
      if (brief.length < 120) {
        console.error(`persona build came back too short (rung ${i + 1}):`, brief.length);
        lastError = new ProviderError("empty", "brief too short to use");
        continue;
      }

      return Response.json({ brief });
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : null;
      console.error(`persona build failed (rung ${i + 1}/${ladder.length})`, code ?? err);
      lastError = err;
      /* Only a block or an empty reply is worth sending less for. A timeout or
         a rate limit is not about the content and the next rung would fail the
         same way, slower. */
      if (code !== "blocked" && code !== "empty") break;
    }
  }

  const { message } = userFacingError(lastError);
  const blocked = lastError instanceof ProviderError && lastError.code === "blocked";
  return Response.json(
    {
      error: blocked
        ? `Google's content filter won't accept these messages, even with most of them removed. Try again with a shorter or less personal excerpt in the "paste some of their messages" box — the description of what they were like matters more anyway.`
        : message,
    },
    { status: 502 }
  );
}
