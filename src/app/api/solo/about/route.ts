import { z } from "zod";

import { getProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { readJson } from "@/lib/http";

/* A gist of the user, from everything they have told the people they talk to.
 *
 * Each character only knows what it was told, so no one place holds the whole
 * picture. This reads the notes from all of them together and writes it down for
 * the user to see: who they are, what they are like, what they are into. It is
 * shown on the user's own profile and is not handed to any character -- what
 * was said to one stays with that one. Stateless.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** How they look, if they have shared photos. */
  look: z.string().max(1200).optional(),
  facts: z
    .array(z.object({ content: z.string().max(500), at: z.string().max(40).optional(), to: z.string().max(60).optional() }))
    .min(1)
    .max(100),
});

const clean = (v: unknown, n: number, each: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, each)).filter(Boolean).slice(0, n) : [];

/* The model's answer as a profile, tolerant of how models wrap or break JSON: a
   fence, prose around it, a raw newline inside a string. If it gave plain prose
   instead of JSON, that prose is the summary. */
function read(text: string): { summary: string; traits: string[]; interests: string[] } | null {
  const s = text.trim().replace(/^```(?:json)?\s*|```$/g, "").trim();
  if (!s) return null;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const body = s.slice(a, b + 1);
    let out: { summary?: unknown; traits?: unknown; interests?: unknown } | null = null;
    try { out = JSON.parse(body); } catch {
      try { out = JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")); } catch { out = null; }
    }
    if (out && typeof out.summary === "string" && out.summary.trim()) {
      return { summary: out.summary.trim().slice(0, 900), traits: clean(out.traits, 6, 40), interests: clean(out.interests, 8, 50) };
    }
    const m = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
    if (m) return { summary: m[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim().slice(0, 900), traits: [], interests: [] };
    return null;
  }
  return s.length >= 40 ? { summary: s.slice(0, 900), traits: [], interests: [] } : null;
}

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await readJson(req); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { name, look, facts } = parsed.data;

  const notes = facts.map((f) => `${f.at ? `[${f.at.slice(0, 10)}] ` : ""}${f.to ? `(told ${f.to}) ` : ""}${f.content}`).join("\n");
  const system = `You write a short profile of ${name}, from notes of what ${name} has told the different people they talk to. The notes are in the third person, newest and oldest mixed, each marked with who it was told to.

Return ONLY JSON, no prose, no code fence:
{"summary": string, "traits": string[], "interests": string[]}

- "summary": three to five sentences written to ${name} in the second person ("You are..."), a warm and honest gist of who they are: what they do, what is going on in their life, who matters to them, what they care about. Use what is in the notes and nothing else.
- "traits": up to six short words or phrases for what they seem like, only where the notes really show it ("loyal to family", "perfectionist about exams").
- "interests": up to eight things they like or are into, each a few words.

Never invent, guess or fill gaps. Where notes disagree, prefer the newer. Leave out intimate or sexual details, and anything about health, money or family trouble unless it is clearly central to their life. ${look ? `They shared photos, which read as: ${look.slice(0, 600)} You may mention how they come across, lightly.` : ""} If the notes are thin, write less rather than padding.`;

  try {
    const { text } = await getProvider().generateResponse({
      system,
      messages: [{ role: "user", content: notes }],
      temperature: 0.3,
      /* Summarising notes needs no long deliberation, and this is on a screen the user is waiting at. */
      thinking: "minimal",
    });
    const out = read(text);
    if (!out) {
      console.error("about: unreadable output:", text.slice(0, 200));
      return Response.json({ about: null, why: "unreadable" });
    }
    return Response.json({ about: out });
  } catch (err) {
    console.error("about failed", err);
    /* Said, so the app can try again with less (a filter can stop a prompt for what is in it). */
    const why = err instanceof ProviderError ? (err.code === "blocked" || err.code === "stopped" ? "blocked" : err.code === "empty" ? "empty" : "error") : "error";
    return Response.json({ about: null, why });
  }
}
