import { z } from "zod";

import { getProvider } from "@/lib/ai";
import { readJson } from "@/lib/http";

/* Older memories, folded into a few vague summaries.
 *
 * What was said in the last week a character remembers in detail; before that,
 * only roughly. This writes the rough version: given a stretch of old notes, a
 * handful of short lines of what that time was about, with no exact times, names
 * of places or quotes beyond what mattered. The notes themselves are not
 * touched -- the app keeps every one -- this only makes what is carried into each
 * reply smaller. Stateless.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  you: z.string().trim().max(80).default("them"),
  items: z
    .array(z.object({ content: z.string().max(500), at: z.string().max(40).optional() }))
    .min(1)
    .max(150),
});

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await readJson(req); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { name, you, items } = parsed.data;

  const notes = items.map((m) => `${m.at ? `[${m.at.slice(0, 10)}] ` : ""}${m.content}`).join("\n");
  const system = `You are ${name}, remembering what ${you} told you a while ago. Below are notes from that time, oldest first. Write how you would remember it now, loosely, the way a friend recalls something from weeks back.

Write between two and six short lines, each starting with "- ". Each is one or two sentences about a stretch or a theme: what ${you} was dealing with, who came up, how things were going. Keep the names of people and places that mattered; drop exact dates, times and small details, and say "around early November" or "a few weeks back" instead. Plain things from the notes only -- never add or guess anything. Intimate or sexual parts in general terms only. No preamble.`;

  try {
    const { text } = await getProvider().generateResponse({
      system,
      messages: [{ role: "user", content: notes }],
      temperature: 0.3,
      thinking: "low",
    });
    const gists = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()).filter(Boolean).slice(0, 6);
    return Response.json({ gists });
  } catch (err) {
    console.error("gist failed", err);
    return Response.json({ gists: null });
  }
}
