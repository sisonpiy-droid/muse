/* Photos, for everyone: a starter keeps what is read from them as an overlay, the user's own look reaches every character, and neither survives being taken away. */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const store = await import("../src/lib/solo/store.ts");
const persona = await import("../src/lib/presence/persona.ts");
const { personaSchema } = await import("../src/lib/presence/schema.ts");
const { mergeStates } = await import("../src/lib/solo/sync.ts");

const results = [];
const check = (n, f) => results.push([n, f]);
const base = () => ({ ...store.parseState(null), userName: "Sam" });

check("a starter takes photos of the two of you: kept as an overlay, read by the prompt, and removable", () => {
  let s = base();
  assert.equal(store.findMuse(s, "builtin-maya").persona.scene, undefined);
  s = store.editMuse(s, "builtin-maya", { scene: "Feels like rainy cafes, warm light, a window seat." });
  assert.equal(store.findMuse(s, "builtin-maya").persona.scene, "Feels like rainy cafes, warm light, a window seat.");
  assert.deepEqual(s.edits["builtin-maya"], { scene: "Feels like rainy cafes, warm light, a window seat." }, "an overlay, not a copy");
  const p = store.promptPersona(store.findMuse(s, "builtin-maya"), "Sam");
  assert.match(persona.personaSystem(p, [], false, undefined, "Asia/Kolkata"), /THE MOOD BETWEEN YOU[\s\S]*rainy cafes/);
  s = store.editMuse(s, "builtin-maya", { scene: null });
  assert.equal(store.findMuse(s, "builtin-maya").persona.scene, undefined, "null takes it away");
});

check("a made character still takes look and scene the same way", () => {
  let s = { ...base(), muses: [{ id: "made-1", builtin: false, name: "Zed", description: "d", relationshipType: "friend", category: "x", traits: [], persona: { them: "Zed", you: "", relationship: "friend", arch: "friend", texture: "close", mode: "character", brief: "b" } }] };
  s = store.editMuse(s, "made-1", { look: "Looks: tall, dark hair.", scene: "Feels like night drives." });
  const m = store.findMuse(s, "made-1");
  assert.equal(m.persona.look, "Looks: tall, dark hair.");
  assert.equal(m.persona.scene, "Feels like night drives.");
  assert.equal(m.persona.brief, "b", "nothing else changes");
});

check("the user's own look reaches the character's prompt, and is absent when there is none", () => {
  const maya = store.findMuse(base(), "builtin-maya");
  const without = store.promptPersona(maya, "Sam");
  assert.equal(without.youLook, undefined);
  assert.ok(!persona.personaSystem(without, [], false, undefined, "Asia/Kolkata").includes("LOOKS, AND THE VIBE"));
  const withLook = store.promptPersona(maya, "Sam", "Looks: curly hair, glasses. Vibe: easygoing.");
  const text = persona.personaSystem(withLook, [], false, undefined, "Asia/Kolkata");
  assert.match(text, /HOW SAM LOOKS, AND THE VIBE THEY GIVE OFF[\s\S]*curly hair, glasses/);
  assert.match(text, /never mention photos/);
});

check("every route accepts it, so no door drops it", () => {
  const out = personaSchema("character").parse({ them: "A", you: "B", youLook: "Looks: x." });
  assert.equal(out.youLook, "Looks: x.");
});

check("it is saved, restored from a backup, and merged between devices", () => {
  const s = { ...base(), self: { look: "Looks: x." } };
  assert.equal(store.parseState(store.serialiseState(s)).self.look, "Looks: x.");
  const r = store.parseBackup(JSON.stringify({ userName: "S", muses: [], conversations: {}, memories: [], self: { look: "Looks: y." } }));
  assert.equal(r.state.self.look, "Looks: y.");
  const merged = mergeStates(base(), { ...base(), self: { look: "Looks: phone." } }, base());
  assert.equal(merged.self.look, "Looks: phone.", "a change on the other device is taken");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
