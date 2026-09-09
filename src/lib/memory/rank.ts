/* Memory ranking (PRD §13).
 *
 * Deliberately pure: no database, no network, no clock reads except the `now`
 * you pass in. §62 wants unit tests on ranking, and ranking is where a
 * companion either feels like it knows you or feels like it grepped a log.
 *
 * The rule that matters most is the threshold. §13 says "do not blindly inject
 * every memory" -- a Muse that mentions your dog when you asked about work is
 * worse than one that says nothing, because it reads as a machine reciting.
 */

export interface RankableMemory {
  id: string;
  content: string;
  type: string;
  importance: number; // 1-5
  confidence: number; // 0-1
  embedding?: number[] | null;
  createdAt: Date;
  lastRetrievedAt?: Date | null;
}

export interface RankedMemory<T extends RankableMemory = RankableMemory> {
  memory: T;
  score: number;
  /** Kept for debugging and for explaining retrieval to ourselves, never shown. */
  parts: { similarity: number; importance: number; recency: number; confidence: number };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOP = new Set([
  "the","a","an","and","or","but","is","are","was","were","be","been","am","i","you","he","she",
  "it","we","they","my","your","his","her","its","our","their","to","of","in","on","at","for",
  "with","about","as","by","from","this","that","these","those","do","does","did","have","has",
  "had","will","would","can","could","should","me","him","them","so","if","then","than","what",
]);

export function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Fallback when embeddings are unavailable. Jaccard-ish overlap, normalised by
 *  the query so a long memory is not punished for containing other things. */
export function lexicalSimilarity(query: string, content: string): number {
  const q = new Set(tokenize(query));
  if (q.size === 0) return 0;
  const c = new Set(tokenize(content));
  let hits = 0;
  for (const t of q) if (c.has(t)) hits++;
  return hits / q.size;
}

/** Half-life decay. Old memories fade but never vanish -- a birthday from a year
 *  ago should still surface when it is relevant. */
export function recencyScore(createdAt: Date, now: Date, halfLifeDays = 45): number {
  const days = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

/* Types that describe who someone *is* should not decay the way a passing event
   does. A name or a preference stays true; "had a rough week" does not. */
const DECAY_EXEMPT = new Set(["PERMANENT", "PREFERENCE", "GOAL"]);

export interface RankOptions {
  queryEmbedding?: number[] | null;
  now?: Date;
  /** Below this, a memory is not worth injecting. */
  threshold?: number;
  limit?: number;
  weights?: { similarity: number; importance: number; recency: number; confidence: number };
}

const DEFAULT_WEIGHTS = { similarity: 0.6, importance: 0.2, recency: 0.12, confidence: 0.08 };

export function rankMemories<T extends RankableMemory>(
  query: string,
  memories: T[],
  opts: RankOptions = {}
): RankedMemory<T>[] {
  const now = opts.now ?? new Date();
  const threshold = opts.threshold ?? 0.25;
  const limit = opts.limit ?? 8;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const qEmb = opts.queryEmbedding;

  const scored = memories.map((m) => {
    // Embeddings when both sides have them, lexical overlap otherwise. Mixing
    // the two in one ranking would compare incomparable scales, so the choice
    // is per-memory and the fallback is only used where it must be.
    const similarity =
      qEmb && m.embedding && m.embedding.length === qEmb.length
        ? Math.max(0, cosineSimilarity(qEmb, m.embedding))
        : lexicalSimilarity(query, m.content);

    const importance = Math.min(1, Math.max(0, (m.importance - 1) / 4));
    const recency = DECAY_EXEMPT.has(m.type) ? 1 : recencyScore(m.createdAt, now);
    const confidence = Math.min(1, Math.max(0, m.confidence));

    const score =
      w.similarity * similarity +
      w.importance * importance +
      w.recency * recency +
      w.confidence * confidence;

    return { memory: m, score, parts: { similarity, importance, recency, confidence } };
  });

  /* Threshold on similarity, not the blended score. Otherwise a very old,
     very important memory clears the bar on importance alone and gets injected
     into a conversation it has nothing to do with -- which is precisely the
     "chatbot retrieved some text" failure §67 warns about. */
  const minSimilarity = threshold;

  return scored
    .filter((s) => s.parts.similarity >= minSimilarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
