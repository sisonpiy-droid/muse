"use client";

import { PERSONAS, type Persona } from "@/lib/personas";
import type { PersonaDraft, Vibe } from "@/lib/presence/persona";
import { rankMemories, type RankableMemory } from "@/lib/memory/rank";

/* Solo mode's storage layer — localStorage, no database, no account.
 *
 * Everything a signed-in MUSE keeps in Postgres lives here instead: the Muses,
 * the conversations, and the memories. The ranking is the same pure module the
 * server uses; it runs in the browser without embeddings and falls back to
 * lexical scoring, which is exactly the path rankMemories already takes when a
 * provider has no embedding model.
 *
 * Every read and write is guarded. localStorage throws outright in some privacy
 * modes rather than returning null, and a companion that crashes on open is
 * worse than one that forgets.
 */

const KEY = "muse.solo/1";

export interface SoloMemory {
  id: string;
  museId: string;
  content: string;
  type: string;
  importance: number;
  confidence: number;
  createdAt: string;
}

export interface SoloMessage {
  id: string;
  from: "user" | "muse";
  content: string;
  at: string;
  /* Which Muse said it. Absent in a one-to-one thread, where there is only one
     possible speaker; required in a circle, where there are several. Optional
     so conversations saved before circles existed still load. */
  speakerId?: string;
  /** Set when the user has changed the text after the fact. */
  edited?: boolean;
}

/* A circle is both halves of what was asked for: a set of people who know one
   another, and a thread they are all in. Keeping it one concept rather than two
   means membership cannot disagree with itself -- being in the group is what it
   means to know the others. */
export interface SoloCircle {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
}

/* The Presence fields are required on a starter and absent on a built
   character, which carries them inside `persona` instead. */
type PresenceFields = "arch" | "texture" | "mode" | "brief" | "samples" | "extra";

export interface SoloMuse
  extends Omit<Persona, PresenceFields>,
    Partial<Pick<Persona, PresenceFields>> {
  id: string;
  /** Personas that shipped with the app cannot be edited or deleted. */
  builtin: boolean;
  /* Someone built from real material carries Presence's full profile --
     archetype, texture, mode, the verbatim samples, the measured statistics.
     Present only for built characters; the four starters have none, and are
     described by the fields above instead. */
  persona?: PersonaDraft;
}

export interface SoloState {
  userName: string | null;
  muses: SoloMuse[];
  conversations: Record<string, SoloMessage[]>;
  memories: SoloMemory[];
  /* How each person is being spoken to right now, keyed by Muse. Kept per Muse
     rather than globally: someone can be prickly with you while someone else is
     not, and a single shared setting would be nonsense. */
  vibes?: Record<string, Vibe>;
  /** Circles share the `conversations` map; ids never collide. */
  circles?: SoloCircle[];
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function builtinMuses(): SoloMuse[] {
  return PERSONAS.map((p) => ({
    ...p,
    id: `builtin-${slug(p.name)}`,
    builtin: true,
    /* `you` is left empty and filled at send time from whatever the user
       called themselves -- it is the one field that cannot be authored here. */
    persona: {
      them: p.name,
      you: "",
      relationship: p.relationshipType,
      arch: p.arch,
      texture: p.texture,
      mode: p.mode,
      brief: p.brief,
      samples: p.samples,
      extra: p.extra,
    },
  }));
}

function empty(): SoloState {
  return { userName: null, muses: [], conversations: {}, memories: [], vibes: {}, circles: [] };
}

/* Characters built before the Presence port stored their voice profile in
   `customInstructions` and had no `persona` at all. Those take the generic
   prompt rather than personaSystem, which means the mood and register controls
   have nothing to act on and the panel does not appear for them — reported as
   "change how this goes isn't working" on a character built days earlier.
   Rebuilt here from what was saved, so old characters get the same treatment as
   new ones without anyone having to make them again. */
function migrate(m: SoloMuse): SoloMuse {
  if (m.persona || m.builtin) return m;
  const brief = m.customInstructions?.trim() || m.description?.trim() || "";
  if (!brief) return m;
  return {
    ...m,
    persona: {
      them: m.name,
      you: "",
      relationship: m.relationshipType || "someone close",
      /* The originals recorded none of these, and guessing would put words in
         a character's mouth. "other" tells the prompt to lean entirely on the
         profile below rather than assume a relationship script. */
      arch: "other",
      texture: "close",
      mode: "character",
      brief,
    },
  };
}

export function loadState(): SoloState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<SoloState>;
    return {
      userName: parsed.userName ?? null,
      muses: Array.isArray(parsed.muses) ? parsed.muses.map(migrate) : [],
      conversations: parsed.conversations ?? {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      vibes: parsed.vibes ?? {},
      circles: Array.isArray(parsed.circles) ? parsed.circles : [],
    };
  } catch {
    return empty();
  }
}

export function saveState(state: SoloState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Quota, or storage disabled. The session keeps working in memory.
    console.error("solo save failed", err);
  }
}

/** Built-ins are not persisted — they ship with the build, so storing copies
 *  would freeze them at whatever they were when someone first visited. */
export function allMuses(state: SoloState): SoloMuse[] {
  return [...state.muses, ...builtinMuses()];
}

export function findMuse(state: SoloState, id: string): SoloMuse | undefined {
  return allMuses(state).find((m) => m.id === id);
}

/** The memories worth sending with this turn (§13). Lexical, since solo mode
 *  has no embeddings; the gate is the same absolute threshold rankMemories
 *  applies whenever it is scoring lexically. */
export function relevantMemories(state: SoloState, museId: string, query: string): string[] {
  const mine: RankableMemory[] = state.memories
    .filter((m) => m.museId === museId)
    .map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      importance: m.importance,
      confidence: m.confidence,
      embedding: null,
      createdAt: new Date(m.createdAt),
      lastRetrievedAt: null,
    }));

  if (!mine.length) return [];
  return rankMemories(query, mine, { limit: 8 }).map((r) => r.memory.content);
}

export function addMemories(
  state: SoloState,
  museId: string,
  incoming: { content: string; type: string; importance: number; confidence: number }[]
): SoloState {
  const known = new Set(
    state.memories.filter((m) => m.museId === museId).map((m) => m.content.trim().toLowerCase())
  );
  const fresh = incoming.filter((m) => m.content && !known.has(m.content.trim().toLowerCase()));
  if (!fresh.length) return state;

  return {
    ...state,
    memories: [
      ...state.memories,
      ...fresh.map((m) => ({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        museId,
        content: m.content,
        type: m.type,
        importance: m.importance,
        confidence: m.confidence,
        createdAt: new Date().toISOString(),
      })),
    ],
  };
}

export function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}


/* ------------------------------------------------------------- circles */

export function circleOf(state: SoloState, id: string): SoloCircle | undefined {
  return state.circles?.find((c) => c.id === id);
}

/** The Muses in a circle, in membership order, skipping any since deleted. */
export function membersOf(state: SoloState, circle: SoloCircle): SoloMuse[] {
  return circle.memberIds
    .map((id) => findMuse(state, id))
    .filter((m): m is SoloMuse => Boolean(m));
}

/** Everyone this Muse knows: the other members of every circle they are in.
 *  Deduplicated, since two people can share more than one circle. */
export function knownTo(state: SoloState, museId: string): SoloMuse[] {
  const ids = new Set<string>();
  for (const c of state.circles ?? []) {
    if (!c.memberIds.includes(museId)) continue;
    for (const id of c.memberIds) if (id !== museId) ids.add(id);
  }
  return [...ids].map((id) => findMuse(state, id)).filter((m): m is SoloMuse => Boolean(m));
}

/* ------------------------------------------------- editing and deleting */

export function editMessage(
  state: SoloState,
  threadId: string,
  messageId: string,
  content: string
): SoloState {
  const log = state.conversations[threadId] ?? [];
  return {
    ...state,
    conversations: {
      ...state.conversations,
      [threadId]: log.map((m) =>
        m.id === messageId ? { ...m, content, edited: true } : m
      ),
    },
  };
}

export function deleteMessage(state: SoloState, threadId: string, messageId: string): SoloState {
  const log = state.conversations[threadId] ?? [];
  return {
    ...state,
    conversations: { ...state.conversations, [threadId]: log.filter((m) => m.id !== messageId) },
  };
}

/** Everything from this message onward. Useful for taking a conversation back
 *  to a fork rather than deleting one line out of the middle of it. */
export function deleteFrom(state: SoloState, threadId: string, messageId: string): SoloState {
  const log = state.conversations[threadId] ?? [];
  const at = log.findIndex((m) => m.id === messageId);
  if (at < 0) return state;
  return {
    ...state,
    conversations: { ...state.conversations, [threadId]: log.slice(0, at) },
  };
}


/** Clears one thread. `alsoForget` drops what was learned in it too — deleting
 *  a conversation while the Muse still remembers every word of it is not what
 *  anybody means by delete, but the two are separable and worth asking about. */
export function deleteConversation(
  state: SoloState,
  threadId: string,
  alsoForget: boolean
): SoloState {
  const conversations = { ...state.conversations };
  delete conversations[threadId];
  return {
    ...state,
    conversations,
    memories: alsoForget ? state.memories.filter((m) => m.museId !== threadId) : state.memories,
  };
}

/** Removes a Muse you built, with its conversation and memories. Built-ins
 *  cannot be removed: they come from the build, not from storage. */
export function deleteMuse(state: SoloState, museId: string): SoloState {
  const conversations = { ...state.conversations };
  delete conversations[museId];
  return {
    ...state,
    muses: state.muses.filter((m) => m.id !== museId),
    conversations,
    memories: state.memories.filter((m) => m.museId !== museId),
    vibes: Object.fromEntries(Object.entries(state.vibes ?? {}).filter(([k]) => k !== museId)),
    circles: (state.circles ?? [])
      .map((c) => ({ ...c, memberIds: c.memberIds.filter((id) => id !== museId) }))
      /* A circle needs two people to be a circle. */
      .filter((c) => c.memberIds.length >= 2),
  };
}

/** Removes a circle and its thread. The people in it are untouched. */
export function deleteCircle(state: SoloState, circleId: string): SoloState {
  const conversations = { ...state.conversations };
  delete conversations[circleId];
  return {
    ...state,
    conversations,
    circles: (state.circles ?? []).filter((c) => c.id !== circleId),
  };
}
