/* What happens to memories over a long relationship.
 *
 * Every bug this pins is one that only appears after a character has been
 * talked to for a while, which is the exact window no amount of trying the app
 * covers. Three of them shipped:
 *
 *   - extraction died permanently at the 61st memory, because the client sent
 *     every memory it had as an advisory list and the route validated that list
 *     like input that mattered, then answered 200 with an empty array
 *   - one memory longer than 400 characters did the same at any count, and
 *     nothing bounded a memory's length when it was written
 *   - and then, fixing those, I added a cap and dropped every existing memory
 *     on the common path. That one survived a typecheck, a build and a manual
 *     read; it was caught by an audit, an hour after I wrote it.
 *
 * The through-line is that all three are invisible: the character keeps
 * replying, the card keeps counting, and nothing anywhere says a word.
 */
import assert from "node:assert";
import { addMemories, MEMORIES_PER_MUSE, MEMORY_CHARS } from "../src/lib/solo/store.ts";

const results = [];
const check = (n, f) => results.push([n, f]);

const blank = () => ({ userName: "Sam", muses: [], conversations: {}, memories: [] });

const say = (content, over = {}) => ({
  content, type: "PERMANENT", importance: 3, confidence: 0.9, ...over,
});

const mineOf = (state, id) => state.memories.filter((m) => m.museId === id);

check("adding a memory keeps the ones already there", () => {
  /* The regression. `others` is everyone else's memories, so returning
     [...others, ...added] silently wiped this character's entire history on
     every successful extraction -- while the header kept counting up, because
     it recounts from the state that had just been emptied. */
  let s = addMemories(blank(), "aditi", [say("User's sister is called Priya.")]);
  s = addMemories(s, "aditi", [say("User works as a structural engineer.")]);
  s = addMemories(s, "aditi", [say("User is allergic to cats.")]);

  assert.equal(mineOf(s, "aditi").length, 3, "each extraction must add, never replace");
  const texts = mineOf(s, "aditi").map((m) => m.content);
  assert.ok(texts.some((t) => t.includes("Priya")), "the first memory must survive the third");
});

check("one character's memories never touch another's", () => {
  let s = addMemories(blank(), "aditi", [say("User's sister is called Priya.")]);
  s = addMemories(s, "maya", [say("User supports Arsenal.")]);
  s = addMemories(s, "aditi", [say("User is allergic to cats.")]);

  assert.equal(mineOf(s, "aditi").length, 2);
  assert.equal(mineOf(s, "maya").length, 1, "writing to one Muse must not disturb another");
});

check("a memory too long to send is never stored in the first place", () => {
  /* The route rejected any entry over 400 characters, and rejecting the list
     rejected the whole request -- so a single long memory ended extraction for
     that character permanently. Clamped at the one place memories are made. */
  const s = addMemories(blank(), "aditi", [say("x".repeat(1200))]);
  const stored = mineOf(s, "aditi")[0];
  assert.ok(stored, "it should still be stored, just shorter");
  assert.ok(
    stored.content.length <= MEMORY_CHARS,
    `stored ${stored.content.length} chars, over the ${MEMORY_CHARS} the routes accept`
  );
});

check("nothing stored can ever exceed what the routes will accept", () => {
  let s = blank();
  for (let i = 0; i < 40; i++) {
    s = addMemories(s, "aditi", [say(`${"y".repeat(600)} ${i}`)]);
  }
  const over = s.memories.filter((m) => m.content.length > MEMORY_CHARS);
  assert.equal(over.length, 0, `${over.length} memories are longer than the routes allow`);
});

check("memories do not grow without bound", () => {
  let s = blank();
  for (let i = 0; i < MEMORIES_PER_MUSE + 120; i++) {
    s = addMemories(s, "aditi", [say(`Fact number ${i} about the user.`, { importance: (i % 5) + 1 })]);
  }
  assert.equal(
    mineOf(s, "aditi").length,
    MEMORIES_PER_MUSE,
    "a character talked to for a year must not rank thousands of memories every turn"
  );
});

check("what survives the cap is the important, then the recent", () => {
  let s = blank();
  for (let i = 0; i < MEMORIES_PER_MUSE + 50; i++) {
    // importance 5 only for the last fifty, so the cap must keep those.
    s = addMemories(s, "aditi", [
      say(`Fact ${i}.`, { importance: i >= MEMORIES_PER_MUSE ? 5 : 1 }),
    ]);
  }
  const kept = mineOf(s, "aditi");
  assert.equal(kept.length, MEMORIES_PER_MUSE);
  assert.ok(
    kept.filter((m) => m.importance === 5).length === 50,
    "forgetting must drop the trivial, not the things that matter"
  );
});

check("the same thing said twice is stored once", () => {
  let s = addMemories(blank(), "aditi", [say("User's sister is called Priya.")]);
  s = addMemories(s, "aditi", [say("user's SISTER is called priya.")]);
  assert.equal(mineOf(s, "aditi").length, 1, "dedup is case- and space-insensitive");
});

check("an empty extraction changes nothing", () => {
  const before = addMemories(blank(), "aditi", [say("User's sister is called Priya.")]);
  const after = addMemories(before, "aditi", []);
  assert.equal(after, before, "no new memories should not mean a new state object");
});

check("a blank memory is not stored", () => {
  const s = addMemories(blank(), "aditi", [say("   "), say("")]);
  assert.equal(mineOf(s, "aditi").length, 0);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
