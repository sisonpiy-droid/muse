import { z } from "zod";

import { getProvider } from "@/lib/ai";

/* Memory extraction for solo mode. Stateless: the client sends the turn and
   what it already knows, and gets back new memories to store itself.

   Without this, solo mode would be a chatbot with characters — which §69 says
   explicitly is not the product. */

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .min(1)
    .max(40),
  known: z.array(z.string().max(400)).max(60).default([]),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ memories: [] });

  try {
    const memories = await getProvider().extractMemories(parsed.data.messages, parsed.data.known);
    return Response.json({ memories });
  } catch (err) {
    /* Never fails the caller. A missed memory is a smaller harm than an error
       banner after a conversation the user thought went fine. */
    console.error("solo extraction failed", err);
    return Response.json({ memories: [] });
  }
}
