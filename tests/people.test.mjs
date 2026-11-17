/* People the user talks about: named in a memory, gathered into a profile, never a character, removable. */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { parseMemories } = await import("../src/lib/ai/gemini.ts");
const store = await import("../src/lib/solo/store.ts");

const results = [];
const check = (n, f) => results.push([n, f]);

const reply = (items) => "```json\n" + JSON.stringify(items) + "\n```";
const item = (content, person) => ({ content, type: "EVENT", importance: 3, confidence: 0.9, ...(person !== undefined ? { person } : {}) });

check("the extractor's person is read; anything that is not a plain name is dropped", () => {
  const out = parseMemories(reply([
    item("Riya, a girl User likes, went on a date with User.", { name: " Riya ", relation: "a girl User likes" }),
    item("No person here."),
    item("Unnamed.", { name: "my friend", relation: "x" }),
    item("The Muse.", { name: "Muse", relation: "x" }),
    item("Digits.", { name: "1234", relation: "x" }),
    item("Not an object.", "Riya"),
  ]));
  assert.deepEqual(out.map((m) => m.person), [{ name: "Riya", relation: "a girl User likes" }, null, null, null, null, null]);
});

const base = () => ({ ...store.parseState(null), userName: "Sam" });
const learn = (s, museId, list) => store.addMemories(s, museId, list.map((x) => ({ type: "EVENT", importance: 3, confidence: 0.9, ...x })));

check("a memory keeps who it is about, and the profile gathers everything said, across characters", () => {
  let s = base();
  s = learn(s, "builtin-leo", [{ content: "User likes a girl called Riya.", person: { name: "Riya", relation: "a girl User likes" } }]);
  s = learn(s, "builtin-maya", [
    { content: "Riya and User went on a date on Saturday.", person: { name: "riya", relation: "" } },
    { content: "User likes tea." },
  ]);
  const people = store.peopleOf(s);
  assert.equal(people.length, 1, "one person, however the name was cased");
  assert.equal(people[0].relation, "a girl User likes", "the relation is kept when a later mention has none");
  assert.equal(people[0].facts.length, 2);
  assert.deepEqual(people[0].heardBy.sort(), ["Leo", "Maya"]);
  assert.equal(s.memories.filter((m) => !m.person).length, 1, "the other memory is untouched");
});

check("a character or the user is never listed as a person", () => {
  let s = base();
  s = learn(s, "builtin-leo", [
    { content: "Maya told User to eat.", person: { name: "Maya", relation: "friend" } },
    { content: "Sam is tired.", person: { name: "Sam", relation: "" } },
    { content: "Anaya is User's sister.", person: { name: "Anaya", relation: "User's sister" } },
  ]);
  assert.deepEqual(store.peopleOf(s).map((p) => p.name), ["Anaya"]);
});

check("removing a profile takes the grouping away and keeps the memory", () => {
  let s = base();
  s = learn(s, "builtin-leo", [{ content: "Anaya is User's sister.", person: { name: "Anaya", relation: "User's sister" } }]);
  const gone = store.hidePerson(s, "ANAYA");
  assert.equal(store.peopleOf(gone).length, 0);
  assert.equal(gone.memories.length, 1);
  assert.equal(gone.memories[0].person, undefined);
  assert.equal(store.peopleOf(s).length, 1, "the original is not changed");
});

check("forgetting a memory takes it out of the profile", () => {
  let s = base();
  s = learn(s, "builtin-leo", [
    { content: "Anaya is User's sister.", person: { name: "Anaya", relation: "User's sister" } },
    { content: "Anaya is getting married.", person: { name: "Anaya", relation: "" } },
  ]);
  const first = s.memories[0].id;
  assert.equal(store.peopleOf(store.deleteMemory(s, first))[0].facts.length, 1);
});

check("a guess is kept only about a named person, worded as a guess, and held as no more than one", () => {
  const out = parseMemories(reply([
    { ...item("Riya likes books.", { name: "Riya", relation: "a girl User likes" }), type: "INFERENCE", confidence: 0.95 },
    { ...item("Probably, she bakes.", { name: "Riya", relation: "" }), type: "INFERENCE", confidence: 0.4 },
    { ...item("Somebody likes jazz.", null), type: "INFERENCE" },
  ]));
  assert.equal(out.length, 2, "one with nobody named is dropped");
  assert.equal(out[0].content, "Probably: Riya likes books.");
  assert.equal(out[0].confidence, 0.6);
  assert.equal(out[1].content, "Probably, she bakes.");
  assert.equal(out[1].confidence, 0.4);
});

check("guesses sit apart from what was said, and can be removed one by one", () => {
  let s = base();
  s = learn(s, "builtin-leo", [
    { content: "User went to a book store with Riya.", person: { name: "Riya", relation: "a girl User likes" } },
    { content: "Probably, Riya likes books.", type: "INFERENCE", confidence: 0.6, person: { name: "Riya", relation: "" } },
  ]);
  const [riya] = store.peopleOf(s);
  assert.deepEqual(riya.facts.map((f) => f.content), ["User went to a book store with Riya."]);
  assert.deepEqual(riya.guesses.map((g) => g.content), ["Probably, Riya likes books."]);
  const after = store.deleteMemory(s, riya.guesses[0].id);
  assert.equal(store.peopleOf(after)[0].guesses.length, 0);
  assert.equal(store.peopleOf(after)[0].facts.length, 1);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
