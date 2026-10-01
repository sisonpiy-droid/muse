"use client";

import { KEY, loadState, saveState, type SaveResult, type SoloState } from "./store";

/* Keeping one browser's copy of everything consistent when more than one copy
 * of the app is running.
 *
 * Everything lives in one localStorage key and every save wrote the whole of
 * it. That is fine for one tab and quietly destructive for two: a second tab,
 * an installed home-screen copy next to a browser tab, or a phone tab that sat
 * in the background for a day all hold the state as it was when they last
 * loaded. The moment one of them saved anything -- a memory landing from an
 * earlier turn, a vibe chip, a reply -- it wrote that old copy over the new
 * one, and the next open showed the conversation as it was twenty or thirty
 * messages ago. Nothing looked wrong until then, because each tab's screen
 * showed its own state.
 *
 * Now every write carries a revision. A save that finds a newer revision on
 * disk than the one it started from does a three-way merge -- against the last
 * state this tab read or wrote -- instead of overwriting, and a tab that hears
 * another one write (or comes back to the foreground) folds those changes in.
 * The app also saves on the way into the background, which is the last moment
 * a phone guarantees any code runs at all.
 */

type Keyed = { id: string };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** One side's value, given the common ancestor. Undefined means absent. */
function pick<T>(base: T | undefined, theirs: T | undefined, ours: T | undefined): T | undefined {
  if (base === undefined) return ours ?? theirs; // added on one side (or both)
  if (theirs === undefined || ours === undefined) {
    /* Deleted on one side. The deletion stands unless the other side changed
       the thing after it was deleted, which is the rarer and more deliberate act. */
    const kept = theirs ?? ours;
    return kept === undefined || same(kept, base) ? undefined : kept;
  }
  return same(ours, base) ? theirs : ours;
}

/* A list of things with ids, in order. Ours sets the order; anything only the
   other side has goes in after whatever came before it over there, so a reply
   lands next to the message it answered. */
export function mergeList<T extends Keyed>(base: T[] = [], theirs: T[] = [], ours: T[] = []): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const Th = new Map(theirs.map((x) => [x.id, x]));
  const O = new Map(ours.map((x) => [x.id, x]));
  const out: T[] = [];
  const placed = new Set<string>();

  for (const o of ours) {
    const v = pick(B.get(o.id), Th.get(o.id), o);
    if (v) { out.push(v); placed.add(o.id); }
  }
  theirs.forEach((t, i) => {
    if (placed.has(t.id)) return;
    const v = pick(B.get(t.id), t, O.get(t.id));
    if (!v) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = out.findIndex((x) => x.id === theirs[j].id);
    out.splice(at + 1, 0, v);
    placed.add(t.id);
  });
  return out;
}

function mergeRecord<V>(
  base: Record<string, V> = {},
  theirs: Record<string, V> = {},
  ours: Record<string, V> = {},
  both?: (b: V | undefined, t: V, o: V) => V
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const k of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
    const b = base[k], t = theirs[k], o = ours[k];
    if (both && t !== undefined && o !== undefined) { out[k] = both(b, t, o); continue; }
    const v = pick(b, t, o);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Both sides' changes since `base`, applied together. */
export function mergeStates(base: SoloState, theirs: SoloState, ours: SoloState): SoloState {
  return {
    ...ours,
    userName: same(ours.userName, base.userName) ? theirs.userName : ours.userName,
    muses: mergeList(base.muses, theirs.muses, ours.muses),
    memories: mergeList(base.memories, theirs.memories, ours.memories),
    circles: mergeList(base.circles ?? [], theirs.circles ?? [], ours.circles ?? []),
    calls: mergeList(base.calls ?? [], theirs.calls ?? [], ours.calls ?? []),
    outreach: {
      ...(theirs.outreach ?? {}),
      ...(ours.outreach ?? {}),
      evaluated: { ...(theirs.outreach?.evaluated ?? {}), ...(ours.outreach?.evaluated ?? {}) },
      triggers: mergeList(base.outreach?.triggers ?? [], theirs.outreach?.triggers ?? [], ours.outreach?.triggers ?? []),
    },
    conversations: mergeRecord(base.conversations, theirs.conversations, ours.conversations,
      (b, t, o) => mergeList(b ?? [], t, o)),
    vibes: mergeRecord(base.vibes, theirs.vibes, ours.vibes),
    edits: mergeRecord(base.edits, theirs.edits, ours.edits),
    feelings: mergeRecord(base.feelings, theirs.feelings, ours.feelings),
    /* Tombstones only ever grow: something forgotten in either copy stays forgotten. */
    forgotten: mergeRecord(base.forgotten, theirs.forgotten, ours.forgotten,
      (_b, t, o) => [...new Set([...t, ...o])]),
  };
}

/** The revision on disk, read from the front of the string without parsing the rest. */
function storedRev(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    return Number(/^\{"rev":(\d+)/.exec(raw)?.[1] ?? 0);
  } catch {
    return null;
  }
}

export class Persister {
  /** What this tab last read from or wrote to disk: the merge base. */
  private base: SoloState | null = null;
  private rev = 0;
  /** The in-memory object that matches disk, so an unchanged state is never rewritten. */
  persisted: SoloState | null = null;

  open(): SoloState {
    const s = loadState();
    this.base = s;
    this.rev = s.rev ?? 0;
    this.persisted = s;
    return s;
  }

  /* Write `state`. If another copy of the app wrote since this one last
     touched disk, merge with what it wrote rather than replace it. Returns the
     state that was written, which is a new object only when a merge happened. */
  save(state: SoloState): { result: SaveResult; state: SoloState } {
    if (state.corrupt) return { result: { ok: false, reason: "corrupt", bytes: 0 }, state };
    let next = state;
    const onDisk = storedRev();
    if (onDisk !== null && onDisk !== this.rev && this.base) {
      const theirs = loadState();
      if (!theirs.corrupt) next = mergeStates(this.base, theirs, state);
    }
    const rev = Math.max(onDisk ?? 0, this.rev) + 1;
    const result = saveState({ ...next, rev });
    if (result.ok) {
      this.base = next;
      this.rev = rev;
      this.persisted = next;
    }
    return { result, state: next };
  }

  /* Another copy wrote. Fold its changes into `current` without writing --
     or, when this tab has nothing unsaved, simply adopt what is on disk, so
     two tabs never take turns rewriting the same thing at each other. Null
     when there is nothing new. */
  refresh(current: SoloState): SoloState | null {
    const onDisk = storedRev();
    if (onDisk === null || onDisk === this.rev || !this.base) return null;
    const theirs = loadState();
    if (theirs.corrupt) return null;
    const unsaved = current !== this.persisted;
    const next = unsaved ? mergeStates(this.base, theirs, current) : theirs;
    this.base = theirs;
    this.rev = onDisk;
    if (!unsaved) this.persisted = theirs;
    return next;
  }
}
