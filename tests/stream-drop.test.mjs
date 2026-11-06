/* A reply stream that closes without the server's "done" was cut off (the tab
   went to the background), and must not be kept as if it were whole. */
import assert from "node:assert";
import { streamReply } from "../src/lib/solo/turn.ts";

const results = [];
const check = (n, f) => results.push([n, f]);

const sse = (...evts) => evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const serve = (text) => {
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });
};
const ask = () => streamReply({}, new AbortController().signal, () => {});

check("a stream that ends with done is a whole reply", async () => {
  serve(sse({ type: "delta", text: "hi there" }, { type: "done" }));
  const out = await ask();
  assert.equal(out.ok, true);
  assert.equal(out.text, "hi there");
});

check("a stream cut before done is a retryable failure, not a short reply", async () => {
  serve(sse({ type: "delta", text: "hi th" }));
  const out = await ask();
  assert.equal(out.ok, false);
  assert.equal(out.retryable, true);
  assert.equal(out.partial, "hi th");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
