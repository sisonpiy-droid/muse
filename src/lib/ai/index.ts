import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { AIProvider, ProviderError } from "./types";

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
