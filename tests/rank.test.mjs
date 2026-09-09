/* Unit tests for memory ranking (§62). No database, no network. */
import assert from "node:assert";
import { rankMemories, cosineSimilarity, lexicalSimilarity, recencyScore } from "../src/lib/memory/rank.ts";

const results = [];
const check = (name, fn) => results.push([name, fn]);
const mem = (o) => ({
  id: o.id, content: o.content, type: o.type ?? "PERMANENT",
  importance: o.importance ?? 3, confidence: o.confidence ?? 0.8,
  embedding: o.embedding ?? null, createdAt: o.createdAt ?? new Date("2026-09-01"),
  lastRetrievedAt: null,
});

check("cosine similarity", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], []), 0, "mismatched lengths must not throw");
});

check("lexical similarity ignores stopwords", () => {
  // "is"/"the"/"my" carry no signal; without stripping them every memory
  // would look vaguely relevant to every question.
  assert.ok(lexicalSimilarity("what is the name of my dog", "User's dog is called Bruno") > 0.4);
  assert.equal(lexicalSimilarity("the a is of", "anything at all"), 0);
});

check("recency decays by half-life", () => {
  const now = new Date("2026-09-09");
  const old = new Date(now.getTime() - 45 * 86400000);
  assert.ok(Math.abs(recencyScore(old, now, 45) - 0.5) < 0.01);
  assert.ok(recencyScore(now, now, 45) > 0.99);
});

check("the dog scenario from §59", () => {
  const memories = [
    mem({ id: "dog", content: "User's dog is called Bruno." }),
    mem({ id: "job", content: "User works as an accountant in Leeds." }),
    mem({ id: "food", content: "User dislikes coriander." }),
  ];
  const out = rankMemories("How is Bruno doing?", memories);
  assert.equal(out[0].memory.id, "dog");
  assert.ok(!out.some((r) => r.memory.id === "food"), "unrelated memories must not be injected");
});

check("irrelevant memories are cut by the threshold, not just ranked lower", () => {
  const memories = [
    // High importance, but nothing to do with the question. The blended score
    // would clear a naive threshold; similarity must gate it instead.
    mem({ id: "birthday", content: "User's birthday is 3rd March.", importance: 5, confidence: 1 }),
  ];
  const out = rankMemories("what did you think of that film", memories);
  assert.equal(out.length, 0, "a high-importance memory must still need to be relevant");
});

check("identity memories do not decay, events do", () => {
  const now = new Date("2026-09-09");
  const longAgo = new Date(now.getTime() - 400 * 86400000);
  const out = rankMemories("tell me about my dog", [
    mem({ id: "perm", content: "User's dog is called Bruno.", type: "PERMANENT", createdAt: longAgo }),
    mem({ id: "evt", content: "User's dog Bruno was at the vet.", type: "EVENT", createdAt: longAgo }),
  ], { now });
  assert.equal(out[0].memory.id, "perm", "a name stays true; a vet trip fades");
  assert.equal(out[0].parts.recency, 1);
  assert.ok(out[1].parts.recency < 0.01);
});

check("embeddings are used when both sides have them", () => {
  const out = rankMemories("anything", [
    mem({ id: "a", content: "no shared words whatsoever", embedding: [1, 0, 0] }),
  ], { queryEmbedding: [1, 0, 0], threshold: 0.5 });
  assert.equal(out.length, 1, "semantic match should win despite zero lexical overlap");
  assert.ok(out[0].parts.similarity > 0.99);
});

check("limit is respected and order is by score", () => {
  const memories = Array.from({ length: 20 }, (_, i) =>
    mem({ id: `m${i}`, content: `User likes football and team number ${i}`, importance: (i % 5) + 1 })
  );
  const out = rankMemories("football", memories, { limit: 3 });
  assert.equal(out.length, 3);
  assert.ok(out[0].score >= out[1].score && out[1].score >= out[2].score);
});

let pass = 0, fail = 0;
for (const [name, fn] of results) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
