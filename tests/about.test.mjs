/* The gist of the user, from everything they told everyone: which notes feed it, and that it is kept for the user alone. */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const store = await import("../src/lib/solo/store.ts");
const persona = await import("../src/lib/presence/persona.ts");
const { mergeStates } = await import("../src/lib/solo/sync.ts");

const results = [];
const check = (n, f) => results.push([n, f]);
const mem = (id, museId, content, type = "PERMANENT", at = "2026-11-10T10:00:00Z") => ({ id, museId, content, type, importance: 3, confidence: 0.8, createdAt: at });
const state = (memories, extra = {}) => ({ ...store.parseState(null), userName: "Sam", memories, ...extra });

check("it reads the notes from every character, tagged with who was told, and leaves out what is not about the user", () => {
  const s = state([
    mem("a", "builtin-leo", "User studies engineering.", "PERMANENT", "2026-11-01T10:00:00Z"),
    mem("b", "builtin-maya", "User's sister is Anaya.", "RELATIONSHIP", "2026-11-05T10:00:00Z"),
    mem("c", "builtin-leo", "Running joke: chotu.", "SHARED"),
    mem("d", "builtin-leo", "The Muse said it would tell User.", "PROMISE"),
    mem("e", "builtin-leo", "Around early November, User was stressed.", "GIST"),
    mem("f", "builtin-leo", "Probably, Riya likes books.", "INFERENCE"),
  ]);
  const got = store.aboutFacts(s);
  assert.deepEqual(got.map((f) => [f.content, f.to]), [["User studies engineering.", "Leo"], ["User's sister is Anaya.", "Maya"]]);
});

check("the same thing told to two people counts once, and a long history keeps the newest", () => {
  const dup = state([mem("a", "builtin-leo", "User likes tea."), mem("b", "builtin-maya", "user likes TEA.")]);
  assert.equal(store.aboutFacts(dup).length, 1);
  const many = state(Array.from({ length: 200 }, (_, i) => mem(`m${i}`, "builtin-leo", `Fact ${i}.`, "PERMANENT", new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString())));
  const got = store.aboutFacts(many);
  assert.equal(got.length, 100);
  assert.equal(got.at(-1).content, "Fact 199.", "the newest are kept");
  assert.equal(got[0].content, "Fact 100.");
});

check("it is kept on the user's profile, saved, merged between devices, and never put in a character's prompt", () => {
  const about = { summary: "You are a student.", traits: ["loyal"], interests: ["chai"], at: "2026-11-18T00:00:00Z", basis: 9 };
  const s = state([], { self: { look: "Looks: x.", about } });
  assert.deepEqual(store.parseState(store.serialiseState(s)).self.about, about);
  const merged = mergeStates(state([]), { ...state([]), self: { about } }, state([]));
  assert.deepEqual(merged.self.about, about, "taken from the other device");
  /* The characters get the photos' look, and only that. */
  const p = store.promptPersona(store.findMuse(s, "builtin-maya"), "Sam", s.self.look);
  const text = persona.personaSystem(p, [], false, undefined, "Asia/Kolkata");
  assert.ok(!text.includes("You are a student."), "the gist is for the user, not for the character");
  assert.ok(!text.includes("loyal"));
});

check("changing the user's name reaches everything that copied it: made characters, the mirror, and the profile reads", () => {
  const made = { id: "made-1", builtin: false, name: "Zed", description: "d", relationshipType: "friend", category: "x", traits: [], persona: { them: "Zed", you: "Sam", relationship: "friend", arch: "friend", texture: "close", mode: "character", brief: "b" } };
  const other = { ...made, id: "made-2", name: "Kit", persona: { ...made.persona, them: "Kit", you: "Samuel" } };
  let s = store.withMirror({ ...state([mem("a", "builtin-leo", "User likes tea.")]), muses: [made, other], self: { about: { summary: "You are x.", traits: [], interests: [], at: "2026-11-18T00:00:00Z", basis: 5 } } });
  s = store.renameUser(s, "  Sameer  ");
  assert.equal(s.userName, "Sameer");
  assert.equal(s.muses.find((m) => m.id === "made-1").persona.you, "Sameer", "set up with the old name: follows");
  assert.equal(s.muses.find((m) => m.id === "made-2").persona.you, "Samuel", "a name they were given specially stays");
  const mirror = s.muses.find((m) => m.id === store.MIRROR_ID);
  assert.equal(mirror.name, "Sameer (you)");
  assert.equal(mirror.persona.them, "Sameer");
  assert.equal(store.renameUser(s, "Sameer"), s, "the same name changes nothing");
  assert.equal(store.renameUser(s, "   "), s, "an empty name changes nothing");
  assert.equal(store.renameUser(s, "x".repeat(100)).userName.length, 60);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
