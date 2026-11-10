/* Makes the starters' default display photos, once, into public/avatars/.
 *
 *   npx tsx scripts/make-avatars.mjs            (dev server on :3300; skips ones already made)
 *
 * Asks the running app's own /api/solo/avatar with the same description the
 * app sends when it draws one on first open, so a shipped photo is what that
 * person would have got anyway. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import sharp from "sharp";

import { builtinMuses } from "../src/lib/solo/store.ts";

const BASE = process.env.MUSE_URL ?? "http://localhost:3300";
const OUT = new URL("../public/avatars/", import.meta.url);
mkdirSync(OUT, { recursive: true });

async function one(m) {
  const file = new URL(`${m.id}.jpg`, OUT);
  if (existsSync(file)) return `${m.id}: kept`;
  const p = m.persona;
  const about = [
    m.relationshipType && `They are someone's ${m.relationshipType}.`,
    m.description,
    (p?.brief ?? "").slice(0, 600),
    m.traits?.length ? `Traits: ${m.traits.join(", ")}.` : "",
  ].filter(Boolean).join(" ").slice(0, 1200);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE}/api/solo/avatar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: m.name, mode: p?.mode ?? "", arch: p?.arch ?? "other", about }),
    });
    if (!res.ok) continue;
    const { data, kind } = await res.json();
    if (typeof data !== "string") continue;
    const jpg = await sharp(Buffer.from(data, "base64")).resize(640, 800, { fit: "cover", position: "top" }).jpeg({ quality: 78 }).toBuffer();
    writeFileSync(file, jpg);
    return `${m.id}: ${kind}, ${Math.round(jpg.length / 1024)} KB`;
  }
  return `${m.id}: FAILED`;
}

const all = builtinMuses();
for (let i = 0; i < all.length; i += 4) {
  console.log((await Promise.all(all.slice(i, i + 4).map(one))).join("\n"));
}
