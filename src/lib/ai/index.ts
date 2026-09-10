import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { REFUSAL_SNIFF_CHARS, looksLikeRefusal, retryNudge } from "./refusal";
import { AIProvider, ChatMessage, ProviderError } from "./types";

export * from "./types";
export { geminiProvider, anthropicProvider };

/* Provider selection is explicit-first.
 *
 * Checking keys in a fixed order is a trap: a stale key left in the environment
 * silently beats the one you meant to use, and nothing in the config hints at
 * it. LLM_PROVIDER decides whenever it is set. */
export function getProvider(): AIProvider {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new ProviderError("no_key", "LLM_PROVIDER=gemini but GEMINI_API_KEY is not set");
    return geminiProvider;
  }
  if (forced === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError("no_key", "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    return anthropicProvider;
  }
  if (process.env.GEMINI_API_KEY) return geminiProvider;
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  throw new ProviderError("no_key", "No model provider is configured");
}

export function hasProvider(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/** Embeddings come from whichever provider actually has them, regardless of
 *  which one is answering chat. Returns null when none does. */
export function getEmbeddingProvider(): AIProvider | null {
  if (process.env.GEMINI_API_KEY) return geminiProvider;
  return null;
}

/* §44: users see a plain sentence, never a provider string or stack trace.
   The detail is logged server-side instead. */
export function userFacingError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof ProviderError) {
    switch (err.code) {
      case "no_key":
      case "bad_model":
        return { message: "Something went wrong on our side. We're looking at it.", retryable: false };
      case "rate_limited":
        return { message: "That's a lot at once. Give it a minute and try again.", retryable: true };
      case "timeout":
        return { message: "That took too long to come back. Try again?", retryable: true };
      case "blocked":
        return { message: "That one couldn't be answered. Try putting it differently.", retryable: false };
      case "empty":
      default:
        return { message: "Something went wrong. Try again.", retryable: true };
    }
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { message: "That took too long to come back. Try again?", retryable: true };
  }
  return { message: "Something went wrong. Try again.", retryable: true };
}


/* ------------------------------------------------- streaming with a guard */

export type GuardedEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  /* `reason` distinguishes three very different failures that used to look
     identical to the caller: the model declined in character-breaking words, it
     produced nothing, or the request never reached generation because the input
     was blocked. They need different messages and different fixes. */
  | { type: "refused"; reason: "refusal" | "empty" | "blocked" };

/** Streams a reply, but holds the opening back long enough to notice a refusal.
 *
 *  A refusal announces itself in the first few words, so buffering that much
 *  costs nothing visible and means the caller never receives — and therefore
 *  never stores — a reply where the character has broken. On a refusal it
 *  retries once with a short reminder; if that refuses too it yields
 *  `refused`, and the caller is expected to keep the conversation unchanged. */
export async function* streamGuarded(opts: {
  system: string;
  messages: ChatMessage[];
  /** Used in the retry reminder. */
  name: string;
  /** A shorter prompt to fall back to before giving up entirely. Carries the
   *  same character with less verbatim material, which is what tends to trip a
   *  safety filter on a persona built from someone's real messages. */
  softenedSystem?: string;
}): AsyncIterable<GuardedEvent> {
  const provider = getProvider();

  /* Three attempts: as asked, then with a reminder, then softened. A slightly
     plainer reply is better than no reply, and a persona that goes silent on
     its owner is the worst outcome available. */
  const attempts = [
    opts.system,
    opts.system + retryNudge(opts.name),
    (opts.softenedSystem ?? opts.system) + retryNudge(opts.name),
  ];

  let lastReason: "refusal" | "empty" | "blocked" = "refusal";
  let lastDetail = "";

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const system = attempts[attempt];
    if (attempt === 2 && !opts.softenedSystem) break;

    let head = "";
    let flushed = false;
    let sawAnything = false;
    const buffered: string[] = [];

    try {
      for await (const delta of provider.streamResponse({ system, messages: opts.messages })) {
        sawAnything = true;
        if (flushed) {
          yield { type: "delta", text: delta };
          continue;
        }

        head += delta;
        buffered.push(delta);
        if (head.length < REFUSAL_SNIFF_CHARS) continue;

        if (looksLikeRefusal(head)) break;      // abandon this attempt
        flushed = true;
        for (const b of buffered) yield { type: "delta", text: b };
      }
    } catch (err) {
      /* A stream that produces nothing, or is stopped by a safety filter, is a
         refusal wearing a different hat -- and it was surfacing as "Something
         went wrong. Try again." with no retry, because the throw escaped this
         loop entirely. Treated as a refusal so it gets the second attempt.
         Anything already flushed to the client cannot be retried, and any
         other kind of failure is still a real error. */
      const code = err instanceof ProviderError ? err.code : null;
      if (flushed || (code !== "empty" && code !== "blocked")) throw err;
      lastReason = code === "blocked" ? "blocked" : "empty";
      lastDetail = err instanceof Error ? err.message : String(err);
    }

    // A reply shorter than the sniff window never flushed; judge it whole.
    if (!flushed && sawAnything && !looksLikeRefusal(head)) {
      flushed = true;
      for (const b of buffered) yield { type: "delta", text: b };
    }

    if (flushed) {
      yield { type: "done" };
      return;
    }

    /* Logged because this is otherwise invisible. When a persona goes quiet the
       only evidence is a message to the user, and without the model's actual
       words there is nothing to diagnose from -- which is exactly the position
       this was reported from. Truncated, and it is the model's output rather
       than anyone's conversation. */
    if (head.trim()) lastReason = "refusal";
    console.error(
      `[refusal] ${opts.name} attempt ${attempt + 1}/${attempts.length} reason=${lastReason}` +
        (lastDetail ? ` detail=${lastDetail}` : "") +
        (head.trim() ? ` text=${head.slice(0, 200).replace(/\s+/g, " ")}` : "")
    );
  }

  yield { type: "refused", reason: lastReason };
}
