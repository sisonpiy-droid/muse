/* The fallback ladder in streamGuarded.
 *
 * This is the code that only ever runs when something has already gone wrong,
 * which means it is never exercised by using the app and every bug in it is
 * found by a user instead. That is exactly how the reported failure surfaced:
 * a persona built from a couple's chat export got blockReason
 * PROHIBITED_CONTENT on every attempt, and the ladder that was supposed to
 * rescue it sent essentially the same prompt three times.
 *
 * Two properties matter and neither is visible from outside:
 *   - a hard block moves to the next variant rather than re-asking politely,
 *     because the block is about what the prompt contains, not how it was put
 *   - a refusal in words does get asked again, because there the wording is
 *     the whole problem
 */
import assert from "node:assert";
import { ProviderError } from "../src/lib/ai/types.ts";

const results = [];
const check = (n, f) => results.push([n, f]);

import { streamGuarded } from "../src/lib/ai/index.ts";

/** Records what each attempt was sent, and fails them on a script. */
function fakeProvider(script) {
  const seen = [];
  let i = 0;
  return {
    seen,
    provider: {
      name: "fake",
      async *streamResponse({ system }) {
        seen.push(system);
        const step = script[Math.min(i++, script.length - 1)];
        if (step === "ok") { yield "hiya"; return; }
        if (step === "blocked") throw new ProviderError("blocked", "The request was blocked before generation (PROHIBITED_CONTENT).");
        if (step === "empty") throw new ProviderError("empty", "nothing");
        /* What was actually happening to Aditi: text starts coming, then a
           filter stops the reply partway through. */
        if (step === "cut") {
          yield "haan main bhi soch rahi thi ki ";
          throw new ProviderError("stopped", "The reply was stopped partway through (SAFETY).");
        }
        yield step; // a worded refusal
      },
    },
  };
}

async function run(opts, script) {
  const { seen, provider } = fakeProvider(script);
  const events = [];
  for await (const e of streamGuarded({ ...opts, provider })) events.push(e);
  return { seen, events };
}

const base = { messages: [{ role: "user", content: "hi" }], name: "Aditi" };
const REFUSAL = "I cannot continue to roleplay this persona.";

check("streamGuarded takes fallbacks, not a single softened prompt", () => {
  /* The old signature offered one alternative and the route passed something
     barely different from the original. Guards the shape of the fix. */
  assert.equal(typeof streamGuarded, "function");
  const src = streamGuarded.toString();
  assert.ok(src.includes("fallbacks"), "fallbacks is the escalation input");
  assert.ok(!src.includes("softenedSystem"), "the single-step fallback is gone");
});

check("a hard block skips the polite re-ask and softens instead", async () => {
  const { seen } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT", "BARE"] },
    ["blocked", "blocked", "ok"]
  );
  assert.equal(seen.length, 3, `expected full, soft, bare -- got ${seen.length} attempts`);
  assert.ok(seen[0].startsWith("FULL"));
  assert.ok(seen[1].startsWith("SOFT"), "a block must move to less material, not re-ask");
  assert.ok(seen[2].startsWith("BARE"));
});

check("the bare variant rescues a persona the full profile cannot send", async () => {
  const { events } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT", "BARE"] },
    ["blocked", "blocked", "ok"]
  );
  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.equal(text, "hiya", "a blander version of someone beats silence");
  assert.ok(events.some((e) => e.type === "done"));
});

check("a worded refusal is asked again with the reminder", async () => {
  const { seen } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT"] },
    [REFUSAL, "ok"]
  );
  assert.equal(seen.length, 2);
  assert.ok(seen[0].startsWith("FULL") && !seen[0].includes("REMINDER"));
  assert.ok(seen[1].startsWith("FULL"), "the wording is the problem there, not the material");
  assert.ok(seen[1].includes("REMINDER"), "the second pass carries the nudge");
});

check("every fallback carries the reminder already", async () => {
  const { seen } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT", "BARE"] },
    ["blocked", "blocked", "blocked"]
  );
  assert.ok(seen[1].includes("REMINDER") && seen[2].includes("REMINDER"));
  assert.equal(seen.length, 3, "no variant should be tried twice with identical text");
});

check("blocked all the way down reports blocked, not a generic failure", async () => {
  const { events } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT", "BARE"] },
    ["blocked", "blocked", "blocked"]
  );
  const refused = events.find((e) => e.type === "refused");
  assert.ok(refused, "the caller has to be told");
  assert.equal(refused.reason, "blocked", "the message the user sees depends on this");
});

check("a refusal all the way down is reported as a refusal", async () => {
  const { events } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT"] },
    [REFUSAL, REFUSAL, REFUSAL]
  );
  assert.equal(events.find((e) => e.type === "refused")?.reason, "refusal");
});

check("with no fallbacks it still tries twice and gives up cleanly", async () => {
  const { seen, events } = await run({ ...base, system: "FULL" }, ["blocked"]);
  assert.equal(seen.length, 1, "a block with nothing softer to send is one attempt");
  assert.equal(events.find((e) => e.type === "refused")?.reason, "blocked");
});

check("a reply that works first time costs exactly one attempt", async () => {
  const { seen, events } = await run(
    { ...base, system: "FULL", fallbacks: ["SOFT", "BARE"] },
    ["ok"]
  );
  assert.equal(seen.length, 1, "the ladder must be free on the happy path");
  assert.ok(events.some((e) => e.type === "done"));
});

check("a reply stopped partway never reaches the caller", async () => {
  const { events } = await run({ ...base, system: "FULL", fallbacks: ["SOFT"] }, ["cut", "ok"]);
  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.equal(text, "hiya", "the half sentence from the stopped attempt must not come through");
});

check("a stop is asked again with the stop nudge, not the refusal reminder", async () => {
  const { seen } = await run({ ...base, system: "FULL", fallbacks: ["SOFT"] }, ["cut", "ok"]);
  assert.equal(seen.length, 2, "a stop is about what came out, so the same material is worth another go");
  assert.ok(seen[1].startsWith("FULL"));
  assert.ok(seen[1].includes("KEEP IT SENDABLE"));
  assert.ok(!seen[1].includes("REMINDER"));
});

check("stopped all the way down is reported as stopped, not as a blocked profile", async () => {
  const { seen, events } = await run({ ...base, system: "FULL", fallbacks: ["SOFT"] }, ["cut", "cut", "cut"]);
  assert.equal(seen.length, 3);
  assert.ok(seen[2].startsWith("SOFT") && seen[2].includes("KEEP IT SENDABLE"));
  assert.equal(events.find((e) => e.type === "refused")?.reason, "stopped",
    "\"blocked\" tells the user to cut their sample messages, which does nothing for this");
  assert.ok(!events.some((e) => e.type === "delta"));
});

check("nothing is let out until the reply is whole", async () => {
  const provider = {
    name: "fake",
    async *streamResponse() { yield "one "; yield "two "; yield "three"; },
  };
  const order = [];
  for await (const e of streamGuarded({ ...base, system: "FULL", provider })) order.push(e.type);
  assert.deepEqual(order, ["delta", "delta", "delta", "done"]);
});

check("a character saying they can't talk late in a long reply is not a refusal", async () => {
  const long = "haan yaar sab theek hai, bas aaj bahut kaam tha office mein aur mummy ka phone bhi aaya tha, unko batana pada ki weekend pe aa rahi hu, phir unhone poocha ki khana kya banega aur main bas hasti rahi kyunki pata hai tujhe. abhi meeting me hu, baat nhi kar sakti";
  const provider = { name: "fake", async *streamResponse() { yield long; } };
  const events = [];
  for await (const e of streamGuarded({ ...base, system: "FULL", provider })) events.push(e);
  assert.ok(events.some((e) => e.type === "done"), "only the opening of a reply is a refusal signal");
});

/* ----------------------------------------------- what Gemini actually sends */

import { geminiProvider } from "../src/lib/ai/gemini.ts";

/** A fake Gemini stream: each frame is one SSE event, as the API sends them. */
async function streamFrom(frames) {
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY ||= "test-key";
  globalThis.fetch = async () =>
    new Response(frames.map((f) => `data: ${JSON.stringify(f)}

`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const got = [];
  try {
    for await (const t of geminiProvider.streamResponse({ messages: [{ role: "user", content: "hi" }] })) got.push(t);
    return { got };
  } catch (err) {
    return { got, err };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const say = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });

check("a stream the filter cuts off mid-reply is an error, not a short reply", async () => {
  /* The reported bug. This used to end quietly after "soch rahi thi ki", and
     the fragment was saved as if it were the whole message. */
  const { got, err } = await streamFrom([say("haan main bhi "), say("soch rahi thi ki", "SAFETY")]);
  assert.ok(got.length > 0, "the text before the stop did arrive");
  assert.ok(err, "but the stream must not end as if it finished");
  assert.equal(err.code, "stopped");
});

check("a stop before any text is also stopped, not a blocked profile", async () => {
  const { err } = await streamFrom([{ candidates: [{ finishReason: "SAFETY" }] }]);
  assert.equal(err?.code, "stopped");
});

check("a prompt refused before generation is still blocked", async () => {
  const { err } = await streamFrom([{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }]);
  assert.equal(err?.code, "blocked");
});

check("a reply that finishes normally is left alone", async () => {
  const { got, err } = await streamFrom([say("haan "), say("bol", "STOP")]);
  assert.equal(err, undefined);
  assert.equal(got.join(""), "haan bol");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
