/* The service worker finishes a reply while the page is away, keeps it, and says so with a notification: only when it should. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

const results = [];
const check = (n, f) => results.push([n, f]);

const SSE = [
  'data: {"type":"delta","text":"[react: 😂]"}',
  'data: {"type":"delta","text":"ok finally! what did you eat"}',
  'data: {"type":"delta","text":"\\n---\\nsend a pic"}',
  'data: {"type":"done"}',
].join("\n\n") + "\n\n";

/* A worker with fakes for everything it touches. `windows` are the open pages. */
function worker({ permission = "granted", windows = [], reply = SSE, status = 200 } = {}) {
  const handlers = {};
  const store = new Map();
  const notes = [];
  let fetched = 0;
  const self = {
    addEventListener: (type, f) => { handlers[type] = f; },
    skipWaiting() {},
    clients: { claim() {}, matchAll: async () => windows },
    registration: { showNotification: async (title, opts) => { notes.push({ title, ...opts }); } },
    Notification: { permission },
    location: { origin: "https://muse.test" },
  };
  const cacheApi = {
    open: async () => ({
      match: async (k) => store.get(k),
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => store.delete(k),
      keys: async () => [...store.keys()],
    }),
  };
  const ctx = vm.createContext({
    self, caches: cacheApi, Response, Request, URL, TextDecoder, console, JSON, Date, Map, Promise,
    fetch: async () => { fetched++; return new Response(reply, { status, headers: { "content-type": "text/event-stream" } }); },
    decodeURIComponent, encodeURIComponent,
  });
  vm.runInContext(code, ctx);
  const ask = async (headers) => {
    const req = new Request("https://muse.test/api/solo/chat", { method: "POST", headers: { "content-type": "application/json", "x-reply-id": "m1", ...headers }, body: "{}" });
    let response; const waits = [];
    handlers.fetch({ request: req, respondWith: (p) => { response = p; }, waitUntil: (p) => waits.push(p) });
    const res = await response;
    await res.text();
    await Promise.all(waits);
    return res;
  };
  return { ask, notes, fetched: () => fetched, store };
}
const who = { "x-reply-muse": encodeURIComponent("builtin-maya"), "x-reply-who": encodeURIComponent("Maya") };

check("a reply that finishes with nobody looking is announced, with its words and a link to the chat", async () => {
  const w = worker();
  await w.ask(who);
  assert.equal(w.notes.length, 1);
  assert.equal(w.notes[0].title, "Maya");
  assert.equal(w.notes[0].body, "ok finally! what did you eat", "no marker, only the first text");
  assert.equal(w.notes[0].tag, "reply-builtin-maya");
  assert.equal(w.notes[0].data.url, "/solo?muse=builtin-maya&reply=1");
});

check("not when the app is open in front of them, nor when they have not allowed notifications", async () => {
  const seen = worker({ windows: [{ visibilityState: "hidden" }, { visibilityState: "visible" }] });
  await seen.ask(who);
  assert.equal(seen.notes.length, 0, "the page shows it");
  const denied = worker({ permission: "denied" });
  await denied.ask(who);
  assert.equal(denied.notes.length, 0);
  const asked = worker({ permission: "default" });
  await asked.ask(who);
  assert.equal(asked.notes.length, 0, "never before they said yes");
});

check("a hidden page counts as away", async () => {
  const w = worker({ windows: [{ visibilityState: "hidden" }] });
  await w.ask(who);
  assert.equal(w.notes.length, 1);
});

check("the reply is kept and handed over once, without asking the model again; names with accents arrive intact", async () => {
  const w = worker();
  await w.ask({ "x-reply-muse": encodeURIComponent("made-1"), "x-reply-who": encodeURIComponent("Zoë 💫") });
  assert.equal(w.notes[0].title, "Zoë 💫");
  assert.equal(w.fetched(), 1);
  const again = await w.ask(who);
  assert.equal(w.fetched(), 1, "served from what was kept");
  assert.equal(w.store.size, 0, "and handed over once");
  assert.equal(again.status, 200);
});

check("a reply cut short or failed is neither kept nor announced", async () => {
  const cut = worker({ reply: 'data: {"type":"delta","text":"half a"}\n\n' });
  await cut.ask(who);
  assert.equal(cut.notes.length, 0);
  assert.equal(cut.store.size, 0);
  const bad = worker({ status: 502 });
  await bad.ask(who);
  assert.equal(bad.notes.length, 0);
});

check("a request with no conversation named still works and says nothing", async () => {
  const w = worker();
  await w.ask({});
  assert.equal(w.notes.length, 0);
  assert.equal(w.store.size, 1, "the reply is still kept for the page");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
