/* Talking to yourself: a character built from the user's own profile and own messages, kept up to date, and nothing else about it changes. */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const store = await import("../src/lib/solo/store.ts");
const persona = await import("../src/lib/presence/persona.ts");
const { personaSchema } = await import("../src/lib/presence/schema.ts");

const results = [];
const check = (n, f) => results.push([n, f]);
const msg = (id, from, content, at) => ({ id, from, content, at });
const mem = (id, museId, content, at = "2026-11-10T10:00:00Z") => ({ id, museId, content, type: "PERMANENT", importance: 3, confidence: 0.8, createdAt: at });

const about = { summary: "You are an engineering student who wants to start a startup.", traits: ["ambitious", "prone to stress"], interests: ["chai", "startups"], at: "2026-11-18T00:00:00Z", basis: 6 };
const base = () => ({
  ...store.parseState(null), userName: "Sam", self: { about, look: "Looks: curly hair." },
  memories: [mem("a", "builtin-leo", "User has a maths exam on Monday."), mem("b", "builtin-maya", "User's sister is Anaya.")],
  conversations: {
    "builtin-leo": [msg("1", "user", "bro i have no idea how i will finish this syllabus", "2026-11-12T10:00:00Z"), msg("2", "muse", "chill", "2026-11-12T10:01:00Z"), msg("3", "user", "ok", "2026-11-12T10:02:00Z")],
    "builtin-maya": [msg("4", "user", "anaya is coming over friday and i have not cleaned anything", "2026-11-13T10:00:00Z")],
  },
});

check("it is made from the profile and from the user's own lines across every chat, not the characters' or filler", () => {
  const p = store.mirrorPersona(base());
  assert.equal(p.them, "Sam");
  assert.equal(p.you, "Sam");
  assert.equal(p.mode, "living");
  assert.match(p.brief, /talking to yourself/);
  assert.match(p.brief, /Who you are: You are an engineering student/);
  assert.match(p.brief, /ambitious, prone to stress/);
  assert.deepEqual(p.samples.split("\n"), ["bro i have no idea how i will finish this syllabus", "anaya is coming over friday and i have not cleaned anything"]);
  assert.match(p.extra, /sister is Anaya/);
  assert.match(p.extra, /Sam has a maths exam/, "written about them by name");
  assert.equal(p.look, "Looks: curly hair.");
});

check("it is one character with a fixed id; making it again updates it and keeps what was added to it", () => {
  let s = store.withMirror(base());
  assert.equal(s.muses.filter((m) => m.id === store.MIRROR_ID).length, 1);
  const m1 = s.muses.find((m) => m.id === store.MIRROR_ID);
  assert.equal(m1.name, "Sam (you)");
  assert.equal(store.findMuse(s, store.MIRROR_ID).persona.them, "Sam");
  s = store.editMuse(s, store.MIRROR_ID, { voiceId: "Kore" });
  s = { ...s, self: { ...s.self, about: { ...about, summary: "You are a founder in the making." } } };
  s = store.withMirror(s);
  assert.equal(s.muses.filter((m) => m.id === store.MIRROR_ID).length, 1, "not duplicated");
  assert.equal(store.findMuse(s, store.MIRROR_ID).voiceId, "Kore", "its voice is kept");
  assert.match(store.findMuse(s, store.MIRROR_ID).persona.brief, /founder in the making/, "and it learns the new profile");
});

check("it reaches the model as a normal character, to the user's own name, and is accepted by every route", () => {
  const s = store.withMirror(base());
  const p = store.promptPersona(store.findMuse(s, store.MIRROR_ID), "Sam", s.self.look);
  assert.doesNotThrow(() => personaSchema("living").parse(p));
  const text = persona.personaSystem(p, [], false, undefined, "Asia/Kolkata");
  assert.match(text, /You are Sam\. You are texting Sam\./);
  assert.match(text, /bro i have no idea how i will finish this syllabus/, "its voice is the user's own lines");
  assert.ok(!persona.romanceAllowed(p), "never romantic: it is the user themselves");
});

check("it is not listed as a person, and does not feed the profile back into itself as a second voice", () => {
  const s = store.withMirror(base());
  const withTalk = { ...s, memories: [...s.memories, mem("z", store.MIRROR_ID, "User wants to quit smoking.")] };
  assert.equal(store.peopleOf(withTalk).length, 0);
  assert.ok(store.aboutFacts(withTalk).some((f) => f.content === "User wants to quit smoking."), "what they tell it still counts as theirs");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
