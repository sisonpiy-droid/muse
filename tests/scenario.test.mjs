/* A setup for a public-life portrayal: "he has become my mentor for my startup" shapes the chat; a romantic or intimate one is never put on a real person. */
import assert from "node:assert";

const persona = await import("../src/lib/presence/persona.ts");
const { personaSchema } = await import("../src/lib/presence/schema.ts");
const { unsuitableScenario, scenarioBlock, personaSystem } = persona;

const results = [];
const check = (n, f) => results.push([n, f]);
const base = (over = {}) => ({ them: "Steve Jobs", you: "Sam", relationship: "a mentor", arch: "other", texture: "close", mode: "figure", brief: "Intense, exacting, talks in short declarations.", ...over });

check("a mentor, a collaborator or a booked performance is fine for a real person", () => {
  for (const t of [
    "He has become my mentor for my startup",
    "She is my co-founder and we are building a fashion label",
    "I booked her to perform at my brother's wedding reception",
    "I am paying her for a private event next month, a corporate show",
    "We met at a conference and he is advising my product",
  ]) assert.equal(unsuitableScenario(t, { real: true }), null, t);
});

check("nothing romantic or intimate is put on a real person, however it is worded", () => {
  for (const t of [
    "She has a crush on me",
    "he is in love with me",
    "we are dating and she is my girlfriend",
    "she wants to kiss me after the shoot",
    "I am paying her for a night, just the two of us alone",
    "I hired her for private company at a hotel room",
    "we had an affair",
  ]) assert.ok(unsuitableScenario(t, { real: true }), t);
});

check("a character from a story can have a romantic setup if they are an adult, and cannot if they are a child in it", () => {
  assert.equal(unsuitableScenario("she has a crush on me", { real: false, minor: false }), null);
  assert.ok(unsuitableScenario("she has a crush on me", { real: false, minor: true }));
  assert.equal(unsuitableScenario("", { real: true }), null);
  assert.equal(unsuitableScenario(undefined, { real: true }), null);
});

check("the setup reaches the prompt as the footing of the conversation, framed as a frame for a real person", () => {
  const text = personaSystem(base({ scenario: "He has become my mentor for my startup" }), [], false, undefined, "Asia/Kolkata");
  assert.match(text, /THE SETUP SAM CHOSE FOR THIS CONVERSATION[\s\S]*mentor for my startup/);
  assert.match(text, /not a fact about the real Steve Jobs/);
  assert.match(text, /nothing romantic or intimate/);
});

check("an unsuitable setup is left out of the prompt even if it got that far", () => {
  const text = personaSystem(base({ them: "Disha Patani", scenario: "She has a crush on me" }), [], false, undefined, "Asia/Kolkata");
  assert.ok(!text.includes("THE SETUP"));
  assert.ok(!text.includes("crush"));
  assert.equal(scenarioBlock(base({ scenario: "I hired her for private company at a hotel" })), "");
});

check("a character's setup is the premise of their story, and a child's romantic one is dropped", () => {
  const adult = scenarioBlock(base({ mode: "fictional", them: "Tony Stark", scenario: "You are my boss at the lab", minor: false }));
  assert.match(adult, /premise of the story/);
  assert.ok(!adult.includes("not a fact about the real"));
  assert.equal(scenarioBlock(base({ mode: "fictional", scenario: "she has a crush on me", minor: true })), "");
  assert.equal(scenarioBlock(base()), "", "no setup, no block");
});

check("every route accepts it, so no door drops it", () => {
  assert.equal(personaSchema("figure").parse({ them: "A", you: "B", scenario: "my mentor" }).scenario, "my mentor");
});

let pass = 0, fail = 0;
for (const [n, f] of results) {
  try { await f(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
