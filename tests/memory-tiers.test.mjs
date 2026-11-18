/* What a character holds in mind: the last week in detail, older things as a rough impression, and nothing ever thrown away. */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const store = await import("../src/lib/solo/store.ts");
const { addMemories, memoriesForTurn, gistable, applyGist, parseState, MEMORIES_PER_MUSE, FRESH_MS, GIST_MIN } = store;

const results = [];
const check = (n, f) => results.push([n, f]);

const NOW = Date.parse("2026-11-18T12:00:00Z");
const DAY = 86_400_000;
const mem = (id, content, daysAgo, extra = {}) => ({
  id, museId: "m", content, type: "EVENT", importance: 3, confidence: 0.8,
  createdAt: new Date(NOW - daysAgo * DAY).toISOString(), ...extra,
});
const state = (memories) => ({ ...parseState(null), userName: "Sam", memories });

check("the ceiling is far above what a month of talking makes, and new things are still learned past the old 300", () => {
  assert.ok(MEMORIES_PER_MUSE >= 3000);
  let s = parseState(null);
  for (let i = 0; i < 320; i++) s = addMemories(s, "m", [{ content: `Old important fact ${i}.`, type: "PERMANENT", importance: 5, confidence: 1 }]);
  s = addMemories(s, "m", [{ content: "Riya likes a book shop near college.", type: "EVENT", importance: 2, confidence: 0.8 }]);
  assert.equal(s.memories.length, 321, "nothing was dropped");
  assert.ok(s.memories.some((m) => m.content.startsWith("Riya likes")), "what was just said is kept");
});

check("everything from the last week goes in, newest first, whatever the topic", () => {
  const fresh = Array.from({ length: 30 }, (_, i) => mem(`f${i}`, `Said this week number ${i}.`, i / 10));
  const got = memoriesForTurn(state(fresh), "m", "hello", null, { now: NOW });
  for (let i = 0; i < 30; i++) assert.ok(got.some((c) => c.startsWith(`Said this week number ${i}.`)), `missing ${i}`);
  assert.ok(!got.some((c) => c.includes("roughly")), "fresh ones are not marked vague");
});

check("past a week it is a rough impression: marked so, and a summary stands in for the notes it covers", () => {
  const notes = Array.from({ length: GIST_MIN }, (_, i) => mem(`o${i}`, `Detail ${i} from three weeks ago.`, 21));
  const s = state(notes);
  const batch = gistable(s, "m", NOW);
  assert.equal(batch.length, GIST_MIN);
  const folded = applyGist(s, "m", batch.map((m) => m.id), ["Around early November Sam was stressed about exams and talked about Anaya."], new Date(NOW - 21 * DAY).toISOString());
  assert.equal(folded.memories.filter((m) => m.type !== "GIST" && m.gist).length, GIST_MIN, "every original is still there, flagged");
  assert.equal(gistable(folded, "m", NOW).length, 0, "and not summarised twice");
  const got = memoriesForTurn(folded, "m", "hello", null, { now: NOW });
  assert.ok(got.some((c) => c.startsWith("Around early November")), "the summary is carried");
  assert.ok(!got.some((c) => c.startsWith("Detail ")), "the old notes are not, unless the talk calls them up");
  const called = memoriesForTurn(folded, "m", "do you remember Detail 3 from three weeks ago", null, { now: NOW });
  assert.ok(called.some((c) => c.startsWith("Detail 3 from three weeks ago") && c.includes("only roughly")), "but they come back, marked rough, when asked about");
});

check("who someone is, promises and the last week are never folded into a summary", () => {
  const s = state([
    mem("a", "Sam's sister is Anaya.", 40, { type: "PERMANENT" }),
    mem("b", "The Muse said it would tell Sam about Riya.", 40, { type: "PROMISE" }),
    mem("c", "Said yesterday.", 1),
    mem("d", "A month-old happening.", 30),
  ]);
  assert.deepEqual(gistable(s, "m", NOW).map((m) => m.id), ["d"]);
});

check("a summary of nothing, or of no memories, changes nothing", () => {
  const s = state([mem("a", "x", 30)]);
  assert.equal(applyGist(s, "m", [], ["something"], "2026-10-01T00:00:00Z"), s);
  assert.equal(applyGist(s, "m", ["a"], ["  "], "2026-10-01T00:00:00Z"), s);
  assert.ok(FRESH_MS === 7 * DAY);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
