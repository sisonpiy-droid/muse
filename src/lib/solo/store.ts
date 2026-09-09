"use client";

import { PERSONAS, type Persona } from "@/lib/personas";
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
}

export interface SoloMuse extends Persona {
  id: string;
  /** Personas that shipped with the app cannot be edited or deleted. */
  builtin: boolean;
}

export interface SoloState {
  userName: string | null;
  muses: SoloMuse[];
  conversations: Record<string, SoloMessage[]>;
  memories: SoloMemory[];
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function builtinMuses(): SoloMuse[] {
  return PERSONAS.map((p) => ({ ...p, id: `builtin-${slug(p.name)}`, builtin: true }));
}

function empty(): SoloState {
  return { userName: null, muses: [], conversations: {}, memories: [] };
}

export function loadState(): SoloState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<SoloState>;
    return {
      userName: parsed.userName ?? null,
      muses: Array.isArray(parsed.muses) ? parsed.muses : [],
      conversations: parsed.conversations ?? {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
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
