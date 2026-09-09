/* Memory ranking (PRD §13).
 *
 * Deliberately pure: no database, no network, no clock reads except the `now`
 * you pass in. §62 wants unit tests on ranking, and ranking is where a
 * companion either feels like it knows you or feels like it grepped a log.
 *
 * The rule that matters most is the gate. §13 says "do not blindly inject
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

/** Which memories stand out from the rest of the set.
 *
 *  An absolute cosine threshold does not work with modern embedding models.
 *  Measured on gemini-embedding-001: every pair of short sentences scores
 *  between 0.50 and 0.65, related or not -- "what should I cook tonight"
 *  against "User has a job interview on Friday" is 0.55. Any fixed cut either
 *  admits everything or nothing.
 *
 *  What carries the signal is the *gap*: the right memory sits well above its
 *  neighbours. So relevance is judged in standard deviations above the mean of
 *  this particular query's scores. When nothing stands out -- a vague "how's
 *  things" scores flat against everything -- the spread collapses and nothing
 *  is injected, which is the correct answer.
 */
export function standoutIndices(similarities: number[], minZ: number, flatSpread: number): number[] {
  const n = similarities.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const mean = similarities.reduce((a, b) => a + b, 0) / n;
  const variance = similarities.reduce((a, s) => a + (s - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);

  // Everything scored alike: nothing is distinctively relevant.
  if (sd < flatSpread) return [];

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if ((similarities[i] - mean) / sd >= minZ) out.push(i);
  }
  return out;
}

export interface RankOptions {
  queryEmbedding?: number[] | null;
  now?: Date;
  /** Lexical mode only: an absolute floor, since lexical scores reach a true 0. */
  threshold?: number;
  /** Embedding mode: how many standard deviations above the mean counts as relevant. */
  minZ?: number;
  /** Embedding mode: below this spread, treat the set as undifferentiated. */
  flatSpread?: number;
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
  const limit = opts.limit ?? 8;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const qEmb = opts.queryEmbedding;

  if (!memories.length) return [];

  /* One mode for the whole set. Mixing cosine and lexical scores in a single
     ranking compares incomparable scales -- and the z-score gate below is
     meaningless across two distributions. */
  const useEmbeddings =
    Boolean(qEmb?.length) && memories.every((m) => m.embedding?.length === qEmb!.length);

  const similarities = memories.map((m) =>
    useEmbeddings
      ? Math.max(0, cosineSimilarity(qEmb!, m.embedding!))
      : lexicalSimilarity(query, m.content)
  );

  const keep = useEmbeddings
    ? new Set(standoutIndices(similarities, opts.minZ ?? 0.6, opts.flatSpread ?? 0.012))
    : new Set(similarities.map((s, i) => (s >= (opts.threshold ?? 0.25) ? i : -1)).filter((i) => i >= 0));

  const scored: RankedMemory<T>[] = [];
  for (let i = 0; i < memories.length; i++) {
    if (!keep.has(i)) continue;
    const m = memories[i];
    const similarity = similarities[i];
    const importance = Math.min(1, Math.max(0, (m.importance - 1) / 4));
    const recency = DECAY_EXEMPT.has(m.type) ? 1 : recencyScore(m.createdAt, now);
    const confidence = Math.min(1, Math.max(0, m.confidence));

    scored.push({
      memory: m,
      score:
        w.similarity * similarity +
        w.importance * importance +
        w.recency * recency +
        w.confidence * confidence,
      parts: { similarity, importance, recency, confidence },
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
