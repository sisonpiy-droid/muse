/* A page frozen by the phone before its save landed: what it had is put back on the next open. */
import assert from "node:assert";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) };

const { Persister, PENDING } = await import("../src/lib/solo/sync.ts");

/* A database in memory, with a switch that makes a write never land, as when the tab is frozen mid-write. */
function database() {
  let raw = null, rev = 0, freeze = false;
  return {
    name: "idb",
    freeze: (v) => { freeze = v; },
    async read() { return { raw, rev }; },
    async revision() { return raw === null ? null : rev; },
    async write(r, n, expected) { if (freeze) return new Promise(() => {}); if (rev !== expected) return "conflict"; raw = r; rev = n; return "ok"; },
  };
}
const msg = (id) => ({ id, from: "user", content: id, at: "2026-11-13T10:00:00Z" });
const open = (db) => { const p = new Persister(db); return p.open(async () => db).then((s) => [p, s]); };

const results = [];
const check = (n, f) => results.push([n, f]);

check("a save that never landed is recovered from the pending copy, and saved properly", async () => {
  store.clear();
  const db = database();
  let [a, s] = await open(db);
  s = { ...s, userName: "Sam", conversations: { m: [msg("one")] } };
  await a.save(s);
  const later = { ...s, conversations: { m: [msg("one"), msg("two")] } };
  db.freeze(true);
  a.backup(later);                 // hidden: written synchronously
  void a.save(later);              // the database write is cut off
  assert.ok(store.get(PENDING), "a pending copy exists");

  const [b, back] = await open(db); // the page opens again, the write still stuck
  db.freeze(false);
  assert.deepEqual(back.conversations.m.map((x) => x.id), ["one", "two"], "the second message is back");
  assert.ok(back !== b.persisted, "and it counts as unsaved, so it gets written");
  const saved = await b.save(back);
  assert.ok(saved.result.ok);
  assert.equal(store.get(PENDING), undefined, "cleared once saved");
  const [, c] = await open(db);
  assert.equal(c.conversations.m.length, 2);
});

check("nothing pending, nothing changes; a state that is already saved is not backed up", async () => {
  store.clear();
  const db = database();
  const [p, s] = await open(db);
  p.backup(s);
  assert.equal(store.get(PENDING), undefined);
  assert.equal((await open(db))[1].userName, null);
});

check("a pending copy built on an older revision is combined with what another copy saved since", async () => {
  store.clear();
  const db = database();
  let [a, s] = await open(db);
  s = { ...s, userName: "Sam", conversations: { m: [msg("one")] } };
  await a.save(s);
  a.backup({ ...s, conversations: { m: [msg("one"), msg("from-phone")] } });
  const [other, o] = await open(db);
  await other.save({ ...o, conversations: { m: [msg("one"), msg("from-laptop")] } });
  const [, again] = await open(db);
  assert.deepEqual(again.conversations.m.map((x) => x.id).sort(), ["from-laptop", "from-phone", "one"]);
});

check("a damaged pending copy is ignored, not trusted", async () => {
  store.clear();
  store.set(PENDING, "{not json");
  const [, s] = await open(database());
  assert.equal(s.userName, null);
  assert.notEqual(s.corrupt, true);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
