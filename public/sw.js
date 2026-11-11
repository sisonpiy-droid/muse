/* MUSE's service worker. It does one thing: show a Muse's text when the
 * server pushes one, and open that Muse's conversation when it is tapped.
 * No offline mode -- this is not a cache of the app.
 *
 * And one more: it carries a reply through the page being put in the
 * background. A phone suspends a tab the moment you leave it, and the reply
 * being fetched dies with it. Asked for through here instead, the request is
 * the worker's, which keeps running; the finished reply is kept, and handed
 * over the moment the page asks for it again on coming back.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "MUSE";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/solo", interactionId: data.interactionId || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/solo", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    /* MUSE already open: bring it forward and tell it where to go, rather than
       opening a second copy beside it. */
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: "muse-open", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

/* ---------------------------------------------------------------- replies */

const REPLIES = "muse-replies";
/* A kept reply older than this is not handed over: the page has moved on. */
const REPLY_TTL = 10 * 60 * 1000;
/** Replies being fetched right now, by the id of the message they answer. */
const pending = new Map();

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const id = req.method === "POST" ? req.headers.get("x-reply-id") : null;
  if (!id || new URL(req.url).pathname !== "/api/solo/chat") return;
  event.respondWith(reply(event, req, id));
});

async function reply(event, req, id) {
  const key = `/__reply/${encodeURIComponent(id)}`;
  const cache = await caches.open(REPLIES);
  /* Already being fetched for a page that went away: wait for that one
     rather than asking (and paying) twice. */
  if (pending.has(id)) await pending.get(id);
  const kept = await cache.match(key);
  if (kept) {
    /* Handed over once. Asking again after that is a new reply. */
    await cache.delete(key);
    if (Date.now() - Number(kept.headers.get("x-made")) < REPLY_TTL) return kept;
  }

  /* A request of the worker's own, so the page going away does not cancel it. */
  const res = await fetch(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) return res;

  const [toPage, toKeep] = res.body.tee();
  const keeping = (async () => {
    const text = await new Response(toKeep).text();
    /* Only a whole reply is worth keeping: the server ends one with "done". */
    if (!text.includes('"type":"done"')) return;
    for (const old of await cache.keys()) await cache.delete(old);
    await cache.put(key, new Response(text, { headers: { "content-type": "text/event-stream", "x-made": String(Date.now()) } }));
  })().catch(() => {}).finally(() => pending.delete(id));
  pending.set(id, keeping);
  event.waitUntil(keeping);
  return new Response(toPage, { status: res.status, headers: res.headers });
}
