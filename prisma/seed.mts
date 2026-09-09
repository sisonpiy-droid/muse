/* Writes the starter personas (PRD §54) into the database.
 *
 *   npm run db:seed
 *
 * The definitions live in src/lib/personas.ts, shared with solo mode.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const { prisma } = await import("../src/lib/db.ts");
const { PERSONAS } = await import("../src/lib/personas.ts");

for (const s of PERSONAS) {

  const existing = await prisma.muse.findFirst({
    where: { name: s.name, ownerUserId: null },
    select: { id: true },
  });

  const data = {
    name: s.name,
    description: s.description,
    relationshipType: s.relationshipType,
    category: s.category,
    languages: s.languages ?? ["English"],
    /* No owner: these ship with the product and belong to nobody, so
       requireOwnedMuse refuses to let anyone edit them. */
    ownerUserId: null,
    visibility: "PUBLIC" as const,
    status: "ACTIVE" as const,
  };

  const personality = {
    traits: s.traits,
    tone: s.tone ?? null,
    humour: s.humour ?? null,
    emotionalStyle: s.emotionalStyle ?? null,
    values: s.values ?? null,
    opinions: s.opinions ?? null,
    sentenceLength: s.sentenceLength ?? null,
    formality: s.formality ?? null,
    catchphrases: s.catchphrases ?? null,
    dialect: s.dialect ?? null,
    customInstructions: s.customInstructions ?? null,
  };

  if (existing) {
    await prisma.muse.update({
      where: { id: existing.id },
      data: { ...data, personality: { update: personality } },
    });
    console.log(`  updated  ${s.name}`);
  } else {
    await prisma.muse.create({
      data: { ...data, personality: { create: personality }, behaviour: { create: {} } },
    });
    console.log(`  created  ${s.name}`);
  }
}

const total = await prisma.muse.count({ where: { ownerUserId: null } });
console.log(`\n${total} seed Muses across ${new Set(PERSONAS.map((s) => s.category)).size} categories`);
await prisma.$disconnect();
