import { z } from "zod";

import { userFacingError } from "@/lib/ai";
import { speak } from "@/lib/ai/gemini";
import { forSpeech, isVoice } from "@/lib/presence/voices";

/* Turning one message into a voice note.
 *
 * Server-side because the key is (§50), and because the provider answers with
 * raw PCM that no browser will play — the WAV wrapping happens there too, so
 * what comes back here is something an <audio> element can be pointed at.
 *
 * Deliberately not part of generating a reply. Speech costs per character and
 * takes about a second a sentence, so speaking every reply automatically would
 * triple the cost of the app and make every turn feel slow, for something most
 * messages do not need. It is a tap on the message you want to hear, and the
 * client caches the result so hearing it again is free.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: z.string().max(40).optional(),
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
    console.error(
      "speak rejected:",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join("; ")
    );
    return Response.json({ error: "There was nothing to say." }, { status: 400 });
  }

  /* An unknown voice falls back rather than failing. A character saved with a
     voice that a later build no longer offers should still speak. */
  const voice = parsed.data.voice && isVoice(parsed.data.voice) ? parsed.data.voice : undefined;
  const text = forSpeech(parsed.data.text);

  try {
    const { audio, mime } = await speak(text, voice ?? "Kore");
    return new Response(new Uint8Array(audio), {
      headers: {
        "content-type": mime,
        "content-length": String(audio.length),
        /* Private and immutable: the audio for a given message and voice never
           changes, but it is one user's conversation and has no business in a
           shared cache. */
        "cache-control": "private, max-age=86400, immutable",
        /* So the client can tell the user when it spoke less than it was given,
           rather than leaving them wondering why it stopped. */
        "x-spoken-chars": String(text.length),
        "x-truncated": String(text.length < parsed.data.text.trim().length),
      },
    });
  } catch (err) {
    console.error("speech failed", err);
    const { message, retryable } = userFacingError(err);
    return Response.json({ error: message, retryable }, { status: 502 });
  }
}
