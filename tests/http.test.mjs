/* Compressed requests: what the browser packs, the route unpacks; plain bodies still work. */
import assert from "node:assert";

const { packJson, readJson, jsonResponse } = await import("../src/lib/http.ts");

const results = [];
const check = (n, f) => results.push([n, f]);
const asRequest = (p) => new Request("http://x/api", { method: "POST", headers: p.headers, body: p.body });

const state = { memories: Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, content: `They said something about their day number ${i}, a chai and a long walk` })), conversations: { a: Array.from({ length: 600 }, (_, i) => ({ id: `c${i}`, from: i % 2 ? "muse" : "user", content: `line ${i} of the chat, text text text`, at: "2026-11-12T10:00:00Z" })) } };

check("a big body is compressed to a fraction, and comes back identical", async () => {
  const p = await packJson(state);
  assert.equal(p.headers["x-body-gzip"], "1");
  const plain = JSON.stringify(state).length;
  assert.ok(p.body.byteLength < plain / 4, `${p.body.byteLength} of ${plain}`);
  assert.deepEqual(await readJson(asRequest(p)), state);
});

check("a small body is sent plain, and a plain body is read plain", async () => {
  const p = await packJson({ a: 1 });
  assert.equal(p.headers["x-body-gzip"], undefined);
  assert.deepEqual(await readJson(asRequest(p)), { a: 1 });
  assert.deepEqual(await readJson(new Request("http://x", { method: "POST", body: JSON.stringify(state) })), state);
});

check("extra headers ride along, and a damaged compressed body is an error, not a crash", async () => {
  const p = await packJson(state, { "x-reply-id": "m1" });
  assert.equal(p.headers["x-reply-id"], "m1");
  const bad = new Request("http://x", { method: "POST", headers: { "x-body-gzip": "1" }, body: new Uint8Array([1, 2, 3, 4]) });
  await assert.rejects(() => readJson(bad));
});

check("a response is compressed only for a client that accepts gzip", async () => {
  const z = await jsonResponse(state, new Request("http://x", { headers: { "accept-encoding": "gzip, br" } }));
  assert.equal(z.headers.get("content-encoding"), "gzip");
  const raw = await jsonResponse(state, new Request("http://x"));
  assert.equal(raw.headers.get("content-encoding"), null);
  assert.deepEqual(await raw.json(), state);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
