"use client";

import { DEFAULT_VIBE, hasFeelings, type Vibe } from "@/lib/presence/persona";
import {
  QUOTE_CHARS, feelingsOf, findMuse, knownTo, memoriesForTurn, plansForTurn, promptPersona, quoteOf,
  windowOf, worthRecalling, type SoloMuse, type SoloState,
} from "./store";
import { embedTexts } from "./learn";

/* One reply's request to /api/solo/chat, and reading its stream.
 *
 * Shared by the text chat and the voice call, so a call is the same character
 * with the same memories, plans, feelings and history -- only the register
 * differs ("live": spoken aloud). There is one place that decides what the
 * model is told, and a call cannot drift from a chat because it has no copy of
 * its own.
 */

export const MAX_MESSAGE = 8000;

export interface PreparedTurn {
  person: SoloMuse;
  vibe: Vibe;
  body: Record<string, unknown>;
}

/** Everything a reply needs, from the state as it is now. */
export async function prepareTurn(
  s: SoloState,
  museId: string,
  opts: {
    signal?: AbortSignal;
    register?: string;
    fallback?: SoloMuse;
    /* On a call, recall by meaning only if it is quick: past this the turn
       goes ahead on word overlap, because silence on the line costs more than
       a slightly worse memory match. */
    embedWithinMs?: number;
  } = {}
): Promise<PreparedTurn | null> {
  const person = findMuse(s, museId) ?? opts.fallback;
  if (!person) return null;
  const thread = s.conversations[museId] ?? [];
  const stored: Vibe = s.vibes?.[museId] ?? DEFAULT_VIBE;
  const vibe: Vibe = opts.register ? { ...stored, register: opts.register } : stored;
  const feelingsNow = feelingsOf(s, museId);

  // The last few turns, so retrieval follows the subject rather than a
  // two-word reply carrying no signal.
  const query = thread.slice(-4).map((m) => m.content).join("\n");
  /* One extra round trip before the reply, and it is what makes recall work on
     meaning rather than shared words. Falls back to overlap when it fails, so
     the cost of it going wrong is a worse memory, not a failed message.
     Skipped entirely when the last few turns are "hmm" and "yeah": there is
     nothing to recall against, and a vector for filler still lands nearest to
     something. Also where most of the half-second goes. */
  const embedding = worthRecalling(query) ? embedTexts([query]) : Promise.resolve(null);
  const timed = opts.embedWithinMs
    ? Promise.race([embedding, new Promise<null>((r) => setTimeout(() => r(null), opts.embedWithinMs))])
    : embedding;
  const [queryVector] = (await timed) ?? [null];
  if (opts.signal?.aborted) return null;
  const memories = memoriesForTurn(s, museId, query, queryVector);

  const body = {
    muse: {
      name: person.name.slice(0, 40),
      description: person.description.slice(0, 400),
      /* Clamped to what the route accepts rather than sent as stored.
         These caps are one-sided -- the wizard let a relationship run to
         120 characters while the route rejects past 40 -- and the reply
         path has no tolerance for a rejection: the offending value is in
         localStorage, so every future request carries it and 400s too.
         One long word typed once during setup ended the character. */
      relationshipType: person.relationshipType.slice(0, 40) || "someone close",
      languages: person.languages ?? ["English"],
      personality: {
        traits: (person.traits ?? []).slice(0, 8),
        values: person.values, humour: person.humour, emotionalStyle: person.emotionalStyle,
        opinions: person.opinions, customInstructions: person.customInstructions,
        tone: person.tone, formality: person.formality, sentenceLength: person.sentenceLength,
        catchphrases: person.catchphrases, dialect: person.dialect,
      },
    },
    // Bounded by size rather than count -- see windowOf.
    messages: windowOf(thread).map((m) => {
      const q = quoteOf(thread, m);
      return {
        role: m.from === "user" ? ("user" as const) : ("assistant" as const),
        /* Same reasoning: one pasted message over the route's limit sat in
           the window and killed every turn after it, permanently. */
        content: m.content.slice(0, MAX_MESSAGE),
        at: m.at,
        ...(q
          ? { quote: { role: q.from === "user" ? "user" : "assistant", content: q.content.slice(0, QUOTE_CHARS) } }
          : {}),
      };
    }),
    /* Present only for someone with a full profile. When it is, the
       server ignores the simple shape above and uses Presence's prompt. */
    persona: promptPersona(person, s.userName),
    /* Everyone they share a circle with. Capped: someone in circles with nine
       or more other people exceeded the route's limit and could no longer hold
       a one-to-one conversation at all. */
    knows: knownTo(s, museId).slice(0, 8).map((k) => ({
      name: k.name.slice(0, 60),
      relationship: k.relationshipType.slice(0, 120),
    })),
    mood: vibe.mood,
    topic: vibe.topic,
    register: vibe.register,
    /* How they are generally, as opposed to how this conversation is
       going. Sent every turn: it is a state, not an event. */
    feelings: hasFeelings(feelingsNow) ? feelingsNow : null,
    /* Clamped on read as well as on write: anything already in someone's
       browser over the limit would 400 the whole request the moment it ranks
       into the top few. */
    memories: memories.map((m) => m.slice(0, 400)),
    /* Dated plans, each with its instant, so the reply knows whether
       "tomorrow at 11" is still ahead or already behind. */
    plans: plansForTurn(s, museId).map((p) => ({ what: p.what.slice(0, 420), at: p.at })),
    userName: s.userName,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  return { person, vibe, body };
}

export type ReplyOutcome =
  | { ok: true; text: string }
  | { ok: false; message: string; retryable: boolean; partial: string };

/* Reads /api/solo/chat's SSE stream, calling onDelta with the text so far. A
   reply that ended in an error is not a reply, however much of it arrived
   first -- the caller decides what, if anything, to keep. */
export async function streamReply(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (soFar: string, delta: string) => void
): Promise<ReplyOutcome> {
  const res = await fetch("/api/solo/chat", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data.error ?? "Something went wrong. Try again.", retryable: true, partial: "" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  let failure: { message: string; retryable: boolean } | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split(/\r?\n/).find((l) => l.startsWith("data:"));
      if (!line) continue;
      let evt: { type?: string; text?: string; message?: string; retryable?: boolean };
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (evt.type === "delta" && evt.text) { acc += evt.text; onDelta(acc, evt.text); }
      else if (evt.type === "error") {
        failure = { message: evt.message ?? "Something went wrong.", retryable: evt.retryable !== false };
      }
    }
  }
  return failure ? { ok: false, ...failure, partial: acc } : { ok: true, text: acc };
}
