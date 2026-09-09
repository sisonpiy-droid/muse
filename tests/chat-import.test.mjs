/* The chat parser is the backbone: if it misreads an export, every persona
   built from one is wrong in a way that is hard to notice. */
import assert from "node:assert";
import { parseExport, styleOf, sampleWindows } from "../src/lib/chat-import.ts";

const results = [];
const check = (n, f) => results.push([n, f]);

// A realistic export: bracketed and unbracketed lines, 12- and 24-hour,
// wrapped messages, media placeholders, system lines, emoji, bursts.
const SAMPLE = [
  "[12/03/2023, 9:14:02 AM] Dad: morning love",
  "[12/03/2023, 9:14:20 AM] Dad: you up yet",
  "[12/03/2023, 9:14:31 AM] Dad: 7 down is beating me again",
  "[12/03/2023, 9:20:11 AM] Nell: Morning! Barely.",
  "[12/03/2023, 9:21:00 AM] Dad: <Media omitted>",
  "[12/03/2023, 9:22:14 AM] Dad: put the kettle on and have a proper think",
  "[12/03/2023, 9:22:40 AM] Dad: thats what i always say",
  "13/03/2023, 18:02 - Nell: Did you get the crossword done?",
  "13/03/2023, 18:09 - Dad: nearly",
  "13/03/2023, 18:09 - Dad: that compiler doesnt know what hes doing",
  "13/03/2023, 18:10 - Dad: anyway hows work",
  "Messages and calls are end-to-end encrypted.",
  "14/03/2023, 08:30 - Nell: Long week. I'll ring Sunday.",
  "14/03/2023, 08:44 - Dad: sunday morning not evening",
  "14/03/2023, 08:44 - Dad: you know the rules",
  "14/03/2023, 08:45 - Dad: this line wraps",
  "onto a second line entirely",
].join("\n");

check("parses both bracketed and dashed line formats", () => {
  const { messages, participants } = parseExport(SAMPLE);
  assert.ok(messages.length >= 14, `got ${messages.length}`);
  assert.deepEqual(participants.map(p => p.name).sort(), ["Dad", "Nell"]);
});

check("drops media placeholders and system lines", () => {
  const { messages } = parseExport(SAMPLE);
  assert.ok(!messages.some(m => /Media omitted/i.test(m.text)));
  assert.ok(!messages.some(m => /end-to-end encrypted/i.test(m.text)));
});

check("a wrapped message joins the line before it", () => {
  const { messages } = parseExport(SAMPLE);
  const wrapped = messages.find(m => m.text.startsWith("this line wraps"));
  assert.ok(wrapped, "wrapped message missing");
  assert.match(wrapped.text, /onto a second line entirely/);
  assert.equal(wrapped.who, "Dad");
});

check("counts messages per participant correctly", () => {
  const { participants } = parseExport(SAMPLE);
  const dad = participants.find(p => p.name === "Dad");
  const nell = participants.find(p => p.name === "Nell");
  assert.ok(dad.count > nell.count, "Dad sends more");
});

check("measures the habits that make a voice recognisable", () => {
  const { messages } = parseExport(SAMPLE);
  const style = styleOf(messages, "Dad");
  // He writes lowercase, rarely punctuates, and sends bursts. All three should
  // be visible in the report a model will be told to imitate.
  assert.match(style.text, /Starts a message lowercase: (8\d|9\d|100)%/);
  assert.match(style.text, /back-to-back messages/);
  assert.ok(style.n >= 9, `measured ${style.n}`);
});

check("distinctive words are relative to the other person", () => {
  // Built so "crossword" is Nell's word and "sunday" is Dad's.
  const extra = Array.from({ length: 6 }, (_, i) =>
    `15/03/2023, 10:0${i} - Dad: sunday sunday sunday`
  ).join("\n");
  const { messages } = parseExport(SAMPLE + "\n" + extra);
  const style = styleOf(messages, "Dad");
  assert.match(style.text, /Words they use far more than the other person:.*sunday/i);
});

check("samples span the history rather than the tail", () => {
  const many = Array.from({ length: 400 }, (_, i) =>
    `16/03/2023, 10:${String(i % 60).padStart(2, "0")} - Dad: message number ${i}`
  ).join("\n");
  const { messages } = parseExport(many);
  const s = sampleWindows(messages, "Dad", 4000);
  assert.ok(s.length > 0, "a dense chat must still yield a sample");
  assert.ok(s.includes("message number 0") || s.includes("message number 1"), "should include the start");
  assert.ok(s.length <= 4100, `budget respected, got ${s.length}`);
});

check("an unrelated file yields no participants rather than throwing", () => {
  const { participants } = parseExport("just some notes\nnothing like a chat here");
  assert.equal(participants.length, 0);
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
