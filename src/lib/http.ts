/* Smaller requests, for Vercel's "Fast Origin Transfer": every byte that goes
 * into or out of a function counts against a monthly allowance, and the biggest
 * things here -- the whole saved state pushed to the account, a conversation
 * sent with each reply -- are repetitive text that shrinks to a fraction of its
 * size.
 *
 * The browser compresses a JSON body with the platform's own gzip and says so
 * in a header of ours; the route undoes it. A browser without CompressionStream
 * just sends it plain, and a route that is sent plain reads it plain, so
 * neither side depends on the other having this. */

const GZIP = "x-body-gzip";
/** Below this, compressing saves nothing worth the work. */
const MIN = 1024;
/** What a route will unpack to. The request itself is capped near 4.5 MB by Vercel, so this is only a guard against a bomb. */
const MAX_UNPACKED = 24_000_000;

export type Packed = { headers: Record<string, string>; body: BodyInit };

/** A JSON request body, compressed when that helps. Spread the result into fetch's init. */
export async function packJson(value: unknown, headers: Record<string, string> = {}): Promise<Packed> {
  const json = JSON.stringify(value);
  const plain: Packed = { headers: { "content-type": "application/json", ...headers }, body: json };
  if (json.length < MIN || typeof CompressionStream === "undefined") return plain;
  try {
    const zipped = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    if (zipped.byteLength >= json.length) return plain;
    return { headers: { "content-type": "application/octet-stream", [GZIP]: "1", ...headers }, body: zipped };
  } catch {
    return plain;
  }
}

/** A route's request body as JSON, whether it came compressed or not. Throws on a bad body, like req.json(). */
export async function readJson(req: Request): Promise<unknown> {
  if (req.headers.get(GZIP) !== "1" || !req.body) return req.json();
  const reader = req.body.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UNPACKED) { await reader.cancel(); throw new Error("request too large once unpacked"); }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

/** A JSON response, compressed for a client that said it can read gzip. */
export async function jsonResponse(value: unknown, req: Request, init: ResponseInit = {}): Promise<Response> {
  const json = JSON.stringify(value);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (json.length >= MIN && /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    try {
      const zipped = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      headers.set("content-encoding", "gzip");
      return new Response(zipped, { ...init, headers });
    } catch { /* plain below */ }
  }
  return new Response(json, { ...init, headers });
}
