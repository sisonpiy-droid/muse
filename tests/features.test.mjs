/* Texting rhythm, reactions, and the story of a relationship.
 *
 * Each of these is a small piece of logic the screen trusts completely: when a
 * text in a burst appears, whether a reply was really just a reaction, what the
 * model is told about reactions, and the numbers on the story page.
 */
import assert from "node:assert";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { lastShowAt, newMessage, paced, react, readReaction, typingMs } = await import("../src/lib/solo/store.ts");
const { prepareTurn, withAppMessage } = await import("../src/lib/solo/turn.ts");
const { storyLine, storyOf } = await import("../src/lib/solo/story.ts");

const results = [];
const check = (n, f) => results.push([n, f]);
const RHEA = "builtin-rhea";
const blank = () => ({ userName: "Piyush", muses: [], conversations: {}, memories: [], vibes: {}, circles: [], calls: [] });

/* ------------------------------------------------------------------ rhythm */

check("a burst is paced: the first text now, each next after a typing pause", () => {
  const parts = ["haan", "bol na kya hua aaj office me", "aur khana khaya?"].map((c) => newMessage("muse", c));
  const out = paced(parts, 1_000_000);
  const at = out.map((m) => Date.parse(m.showAt));
  assert.equal(at[0], 1_000_000);
  assert.ok(at[1] - at[0] >= 700 && at[1] - at[0] <= 2700);
  assert.ok(at[2] > at[1]);
  assert.equal(lastShowAt(out), at[2]);
});

check("a longer text takes longer to type, within bounds, and the same text always the same", () => {
  const short = { id: "a", content: "ok" };
  const long = { id: "a", content: "x".repeat(200) };
  assert.ok(typingMs(long) > typingMs(short));
  assert.ok(typingMs(long) <= 2700 && typingMs(short) >= 700);
  assert.equal(typingMs(long), typingMs(long));
});

/* --------------------------------------------------------------- reactions */

check("a reply opening with [react: …] is a reaction, and may be the whole reply", () => {
  assert.deepEqual(readReaction("[react: 😂] haha true"), { emoji: "😂", rest: "haha true" });
  assert.deepEqual(readReaction("[react:❤️]"), { emoji: "❤️", rest: "" });
  assert.deepEqual(readReaction("[react: 🙄]\n\ndin ke 10 baje?"), { emoji: "🙄", rest: "din ke 10 baje?" });
  assert.deepEqual(readReaction("no tag here [react: 😂]"), { emoji: null, rest: "no tag here [react: 😂]" });
});

check("reacting sets one emoji per side; the same one again takes it off", () => {
  let s = { ...blank(), conversations: { [RHEA]: [{ id: "m1", from: "muse", content: "hi", at: "2026-10-01T10:00:00Z" }] } };
  s = react(s, RHEA, "m1", "user", "❤️");
  assert.equal(s.conversations[RHEA][0].reactions.user, "❤️");
  s = react(s, RHEA, "m1", "muse", "😂");
  assert.deepEqual(s.conversations[RHEA][0].reactions, { user: "❤️", muse: "😂" });
  s = react(s, RHEA, "m1", "user", "❤️");
  assert.deepEqual(s.conversations[RHEA][0].reactions, { muse: "😂" });
});

check("the model hears about reactions in the right place, in parentheses", async () => {
  const s = { ...blank(), conversations: { [RHEA]: [
    { id: "u1", from: "user", content: "goodnight", at: "2026-10-01T10:00:00Z", reactions: { muse: "😴" } },
    { id: "m1", from: "muse", content: "so ja ab", at: "2026-10-01T10:00:05Z", reactions: { user: "❤️" } },
    { id: "u2", from: "user", content: "haha ok", at: "2026-10-01T10:01:00Z" },
  ] } };
  const { body } = await prepareTurn(s, RHEA);
  const [first, , third] = body.messages;
  assert.match(first.content, /^\(you reacted 😴 to this\)\ngoodnight$/);
  assert.match(third.content, /^\(reacted ❤️ to your "so ja ab"\)\nhaha ok$/);
  assert.ok(!body.messages.some((m) => /^\[/.test(m.content)), "never brackets: those are timestamps");
});

check("an app message in a full window gives up the oldest, staying within the route's 60", async () => {
  const thread = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, from: i % 2 ? "muse" : "user", content: `m${i}`, at: new Date(1e12 + i * 1000).toISOString() }));
  const prepared = await prepareTurn({ ...blank(), conversations: { [RHEA]: thread } }, RHEA);
  assert.equal(prepared.body.messages.length, 60);
  withAppMessage(prepared, "(the call just connected)");
  assert.equal(prepared.body.messages.length, 60);
  assert.equal(prepared.body.messages.at(-1).content, "(the call just connected)");
});

/* ------------------------------------------------------------------- story */

const day = (d, h = 12) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
const storyState = () => ({
  ...blank(),
  conversations: { [RHEA]: [
    { id: "a", from: "user", content: "hi", at: day(1) },
    { id: "b", from: "muse", content: "hey", at: day(1) },
    { id: "c", from: "user", content: "look", at: day(3), image: { id: "img", w: 1, h: 1 } },
    { id: "d", from: "muse", content: "texted first", at: day(4), proactive: { interactionId: "i" } },
    { id: "e", from: "user", content: "yo", at: day(5), reactions: { muse: "😂" } },
    { id: "f", from: "muse", content: "later", at: day(5), showAt: day(9) },
  ] },
  calls: [{ id: "c1", museId: RHEA, startedAt: day(4, 15), durationSeconds: 300, status: "COMPLETED" }],
  memories: [
    { id: "m1", museId: RHEA, content: "User has an exam on Friday.", type: "EVENT", importance: 3, confidence: 1, createdAt: day(2), at: day(9) },
    { id: "m2", museId: RHEA, content: "User likes chai.", type: "PREFERENCE", importance: 3, confidence: 1, createdAt: day(2) },
  ],
});

check("the story counts days, streaks, calls and firsts from what is kept", () => {
  const s = storyOf(storyState(), RHEA, Date.parse(day(5, 20)), "UTC");
  assert.equal(s.since, day(1));
  assert.equal(s.daysTalked, 4, "days 1, 3, 4, 5");
  assert.equal(s.streak, 3, "3, 4 and 5 in a row, ending today");
  assert.equal(s.messages, 5, "a text not shown yet is not counted");
  assert.equal(s.calls, 1);
  assert.equal(s.callMinutes, 5);
  assert.deepEqual(s.milestones.map((m) => m.label), [
    "First message", "First photo you sent", "First time they texted you first", "First call", "First time they reacted to you",
  ]);
  assert.deepEqual(s.moments.map((m) => m.id), ["m1"], "events only");
});

check("a streak survives until the day after, then ends", () => {
  assert.equal(storyOf(storyState(), RHEA, Date.parse(day(6, 9)), "UTC").streak, 3);
  assert.equal(storyOf(storyState(), RHEA, Date.parse(day(7, 9)), "UTC").streak, 0);
});

check("the model's one line of history is background, and absent when there is none", () => {
  const line = storyLine(storyOf(storyState(), RHEA, Date.parse(day(5, 20)), "UTC"), Date.parse(day(5, 20)));
  assert.match(line, /talking here for a few days, on 4 of the last 14 days, 3 days in a row now, 1 call/);
  assert.equal(storyLine(storyOf(blank(), RHEA, Date.now(), "UTC"), Date.now()), null);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
