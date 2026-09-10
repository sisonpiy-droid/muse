import { z } from "zod";

import { getProvider, userFacingError } from "@/lib/ai";

/* Build a persona from a real chat export.
 *
 * The browser does the parsing and the measuring; this receives only what it
 * needs — the measured writing habits and a sampled excerpt — and turns them
 * into a persona definition. The rest of the conversation never leaves the
 * device, which matters because a two-person chat contains a second person who
 * agreed to none of this.
 *
 * Stateless. No database, no session.
 */

export const runtime = "nodejs";

/* Building a brief is the slowest call in the product: a real export produces a
   large prompt, and Gemini spends several hundred tokens reasoning before it
   writes. Measured at 14s on a realistic payload, which is close enough to the
   platform default that a bigger chat would be killed mid-generation and
   surface as a network error with nothing to explain it. */
export const maxDuration = 60;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  relationship: z.string().trim().min(1).max(60),
  /* Presence's three modes, kept because the distinction is the whole safety
     story. A living person can object to a version of themselves; someone who
     has died cannot, and an invented character has nobody to object. */
  mode: z.enum(["memorial", "living", "character"]),
  /** Required for `living`: whether they know and agreed. */
  consent: z.boolean().nullish(),
  styleReport: z.string().max(4000),
  samples: z.string().max(14000),
  notes: z.string().max(2000).optional(),
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
  const { name, relationship, mode, consent, styleReport, samples, notes } = parsed.data;

  /* §35. Refused server-side as well as in the UI, so the check cannot be
     skipped by calling the endpoint directly. */
  if (mode === "living" && consent !== true) {
    return Response.json(
      {
        error:
          "Someone still living can object to a version of themselves, and this one would be built out of things they said to you privately. Ask them first.",
        code: "consent_required",
      },
      { status: 403 }
    );
  }

  const framing =
    mode === "memorial"
      ? "This person has died. The user is building a version of them to talk to. Treat the material as precious and be accurate rather than flattering — a idealised version is not them."
      : mode === "living"
        ? "This person is alive and has agreed to this. Stay close to the evidence; do not invent a warmer or worse version than the messages show."
        : "This is a character the user is inventing, loosely based on the messages. You may extrapolate more freely.";

  const system = `You write a character brief from real chat messages, so that another model can convincingly speak as that person.

${framing}

You are given: measured statistics about how they write, and excerpts spanning the whole history.

Write a brief in plain prose, under 400 words, covering in this order:

1. How they write and speak. Be forensic and specific: capitalisation, punctuation habits, message length, whether they send several short messages instead of one, spelling quirks, abbreviations, how they open and close. Quote their real phrases verbatim. The statistics are more reliable than your impression — use them.
2. Who they are to this person. Their manner, their humour, what they are like when the user is upset, what they tease about, what they avoid.
3. What they talk about unprompted. Their subjects, obsessions, the thing they always steer back to. Be concrete: not "sport" but the actual team.

Do not write a eulogy and do not write a summary of the conversation. Write instructions for being them.

Never invent biographical facts that are not in the material. If the material is thin on something, say so plainly in one line at the end.`;

  const user = [
    `Their name: ${name}`,
    `They are the user's: ${relationship}`,
    notes?.trim() ? `\nWhat the user said about them:\n${notes.trim()}` : "",
    `\nMeasured writing habits:\n${styleReport}`,
    `\nMessage excerpts:\n${samples}`,
  ].join("\n");

  try {
    /* Uncapped: Gemini spends several hundred tokens reasoning before writing,
       and a cap covers thinking and output together — a capped brief comes back
       truncated mid-sentence. */
    const { text } = await getProvider().generateResponse({
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0.7,
    });

    return Response.json({ brief: text });
  } catch (err) {
    console.error("persona build failed", err);
    const { message } = userFacingError(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
