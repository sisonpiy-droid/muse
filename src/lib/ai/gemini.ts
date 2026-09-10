import { sseData } from "./sse";
import {
  AIProvider,
  ChatMessage,
  ExtractedMemory,
  GenerateOptions,
  GenerateResult,
  ProviderError,
} from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

const key = () => process.env.GEMINI_API_KEY ?? "";
const model = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";
/* text-embedding-004 was retired and 404s -- the same failure mode as the old
   chat model. Ask the API what it actually serves before changing this. */
const embedModel = () => process.env.EMBEDDING_MODEL || "gemini-embedding-001";
const timeoutMs = () => Number(process.env.UPSTREAM_TIMEOUT_MS || 60000);

/* The key travels as a header, never in the query string. A key in a URL is
   written to access logs, kept by proxies, and quoted back inside error text. */
function headers() {
  if (!key()) throw new ProviderError("no_key", "GEMINI_API_KEY is not set");
  return { "content-type": "application/json", "x-goog-api-key": key() };
}


/* Gemini blocks at MEDIUM by default, and that is the wrong threshold for this
   product. A persona built from a real couple's messages carries their actual
   affection, and the reply is affection back -- ordinary between partners, and
   squarely inside what a medium threshold stops. The symptom is not an error
   but an empty response: the prompt is rejected, three attempts fail in three
   seconds, and the user is told their partner "didn't come to the phone".
   Diagnosed from exactly that.

   ONLY_HIGH, not NONE. High-confidence harmful content is still blocked; what
   changes is that a consenting adult talking to a companion they built is no
   longer caught by a setting meant for something else. */
const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

/** Gemini calls the assistant role "model" and takes the system prompt as its
 *  own field rather than a message. */
function toGeminiBody(opts: GenerateOptions) {
  const body: Record<string, unknown> = {
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 1,
      /* Omitted deliberately when no cap is asked for. Gemini 3.x spends 300-1000
         tokens reasoning before it writes, and maxOutputTokens caps thinking and
         reply together -- an 850-token budget measured out at 30 tokens of actual
         text. thinkingConfig.thinkingBudget:0 is not a workaround: 3.6-flash
         rejects it with a 400 and 3.8-flash ignores it. */
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    },
  };
  body.safetySettings = SAFETY_SETTINGS;
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  return body;
}

/** Strips anything key-shaped before an error goes anywhere a user might see. */
function redact(text: string): string {
  let out = String(text ?? "");
  const k = key();
  if (k.length > 8) out = out.split(k).join("<redacted>");
  return out
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "<redacted>")
    .replace(/(key|api[_-]?key|token)=[^&\s"']+/gi, "$1=<redacted>");
}

function classify(status: number, detail: string): ProviderError {
  const d = redact(detail);
  if (status === 404 || /no longer available|not found|not supported/i.test(d)) {
    return new ProviderError("bad_model", `Model "${model()}" is unavailable: ${d}`, status);
  }
  if (status === 429) return new ProviderError("rate_limited", d, status);
  if (status === 401 || status === 403) return new ProviderError("no_key", d, status);
  return new ProviderError("upstream", d, status);
}

async function post(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(timeoutMs()),
  });
  return res;
}

function textOf(data: unknown): {
  text: string;
  finish?: string;
  blocked?: string;
  usage?: GenerateResult["usage"];
} {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    /* Set when the *input* was rejected rather than the output. Without reading
       it, a blocked prompt is indistinguishable from a model that said nothing,
       which is what made this take three rounds to find. */
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const cand = d?.candidates?.[0];
  /* Deliberately NOT trimmed. A streaming delta may legitimately be " you" or
     "the " -- trimming each fragment silently welds words together, which
     showed up as "prepareyou" and "Pull upthe" on screen. Callers that want a
     whole response trim once, at the end. */
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  return {
    text,
    finish: cand?.finishReason,
    blocked: d?.promptFeedback?.blockReason,
    usage: {
      inputTokens: d?.usageMetadata?.promptTokenCount,
      outputTokens: d?.usageMetadata?.candidatesTokenCount,
      thinkingTokens: d?.usageMetadata?.thoughtsTokenCount,
    },
  };
}

export const geminiProvider: AIProvider = {
  name: "gemini",

  async generateResponse(opts: GenerateOptions): Promise<GenerateResult> {
    const res = await post(`models/${encodeURIComponent(model())}:generateContent`, toGeminiBody(opts), opts.signal);
    const data = await res.json();
    if (!res.ok) throw classify(res.status, (data as { error?: { message?: string } })?.error?.message || "no detail");

    const { text: rawText, finish, blocked, usage } = textOf(data);
    const text = rawText.trim();
    if (blocked) {
      throw new ProviderError("blocked", `The request was blocked before generation (${blocked}).`);
    }
    if (!text) {
      if (finish === "SAFETY") throw new ProviderError("blocked", "The reply was blocked on safety grounds.");
      if (finish === "MAX_TOKENS") {
        throw new ProviderError("empty", "The whole token budget went on reasoning before any reply was written.");
      }
      throw new ProviderError("empty", `Nothing came back (finishReason: ${finish ?? "unknown"}).`);
    }
    return { text, usage, model: model() };
  },

  async *streamResponse(opts: GenerateOptions): AsyncIterable<string> {
    const res = await post(
      `models/${encodeURIComponent(model())}:streamGenerateContent?alt=sse`,
      toGeminiBody(opts),
      opts.signal
    );
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const d = await res.json();
        detail = (d as { error?: { message?: string } })?.error?.message || detail;
      } catch { /* keep the status */ }
      throw classify(res.status, detail);
    }

    let emitted = false;
    let blockedBy: string | undefined;
    let lastFinish: string | undefined;
    for await (const payload of sseData(res.body)) {
      try {
        const { text, blocked, finish } = textOf(JSON.parse(payload));
        if (blocked) blockedBy = blocked;
        if (finish) lastFinish = finish;
        if (text) { emitted = true; yield text; }
      } catch { /* a frame we cannot parse is not worth killing the stream for */ }
    }

    if (!emitted) {
      /* Naming the cause matters: a blocked prompt and a model that simply said
         nothing look identical from the outside, and are fixed differently. */
      if (blockedBy) throw new ProviderError("blocked", `The request was blocked before generation (${blockedBy}).`);
      if (lastFinish === "SAFETY") throw new ProviderError("blocked", "The reply was stopped on safety grounds.");
      throw new ProviderError("empty", `The model streamed nothing back (finishReason: ${lastFinish ?? "none"}).`);
    }
  },

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!key()) return null;
    const res = await post(`models/${encodeURIComponent(embedModel())}:embedContent`, {
      content: { parts: [{ text }] },
    });
    if (!res.ok) {
      // Retrieval falls back to lexical scoring rather than failing the request:
      // a Muse that recalls slightly less well beats a Muse that errors.
      console.error("embedding failed", res.status, redact(await res.text().catch(() => "")));
      return null;
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data?.embedding?.values ?? null;
  },

  async summarize(text: string, instruction?: string): Promise<string> {
    const { text: out } = await this.generateResponse({
      system:
        instruction ??
        "Summarise the conversation below in under 120 words. Keep facts about the user, " +
          "decisions, and anything they seemed to care about. Write plainly, no preamble.",
      messages: [{ role: "user", content: text }],
      // Uncapped for the same reason as extraction: the cap covers reasoning.
      temperature: 0.3,
    });
    return out;
  },

  extractMemories(transcript: ChatMessage[], existingMemories: string[]): Promise<ExtractedMemory[]> {
    return extractMemoriesVia(this, transcript, existingMemories);
  },
};

/* Shared by both providers: the prompt and the parsing are identical, only the
   model differs. Kept here rather than duplicated in anthropic.ts. */
export async function extractMemoriesVia(
  provider: AIProvider,
  transcript: ChatMessage[],
  existingMemories: string[]
): Promise<ExtractedMemory[]> {
  const convo = transcript.map((m) => `${m.role === "user" ? "User" : "Muse"}: ${m.content}`).join("\n");
  const known = existingMemories.length
    ? `Already known, do not repeat these:\n${existingMemories.map((m) => `- ${m}`).join("\n")}`
    : "Nothing is known about this user yet.";

  const system = `You pull durable facts out of a conversation so a companion can remember them later.

${known}

Return ONLY a JSON array. No prose, no code fence. Each item:
{"content": string, "type": "PERMANENT"|"PREFERENCE"|"GOAL"|"RELATIONSHIP"|"EVENT", "importance": 1-5, "confidence": 0-1}

Record something only if it is durable, useful later, and about the user. A fact
stated once in passing still counts; small talk does not. Focus on the turns
marked (latest), but use the earlier ones to resolve what they refer to -- write
"their interview on Friday", not "an event on Friday", when the earlier turns
say what it is. Write each memory as a
plain third-person sentence about the user, e.g. "User's dog is called Bruno."

Do not invent anything. Do not record the Muse's own statements as facts about
the user. If nothing qualifies, return [].`;

  /* No maxTokens. Gemini 3.x spends 300-1000 tokens reasoning before it writes
     anything, and the cap covers thinking and output together -- a 900 budget
     left too little for the JSON, which then failed to parse and looked exactly
     like "there was nothing worth remembering". Silent, and wrong. */
  const { text } = await provider.generateResponse({
    system,
    messages: [{ role: "user", content: convo }],
    temperature: 0.2,
  });

  const parsed = parseMemories(text);
  if (!parsed.length && text.trim() && text.trim() !== "[]") {
    /* Distinguishes "nothing qualified" from "the model wrote something we
       could not read". Without this the two are indistinguishable in logs. */
    console.error("memory extraction produced unparseable output:", text.slice(0, 300));
  }
  return parsed;
}

/** Models wrap JSON in fences or prose often enough that this must be tolerant. */
export function parseMemories(raw: string): ExtractedMemory[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const types = new Set(["PERMANENT", "PREFERENCE", "GOAL", "RELATIONSHIP", "EVENT"]);
  const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  };

  return parsed
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      content: String(m.content ?? "").trim(),
      type: (types.has(String(m.type)) ? String(m.type) : "PERMANENT") as ExtractedMemory["type"],
      importance: Math.round(clamp(m.importance, 1, 5, 3)),
      confidence: clamp(m.confidence, 0, 1, 0.7),
    }))
    .filter((m) => m.content.length > 0 && m.content.length <= 500);
}
