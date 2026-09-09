# MUSE

Create anyone. Talk to anyone.

AI personalities with memory and relationship continuity. Built to the MUSE PRD;
this is Phases 0–3 (foundation, core experience, conversation, memory). Voice and
proactive interactions are designed for in the schema but not built.

## Stack

Next.js App Router · Prisma · Postgres · Auth.js · Gemini or Anthropic behind a
provider interface.

## Running locally

```
npm install
cp .env.example .env.local     # fill in DATABASE_URL, AUTH_SECRET, a model key
npm run db:migrate             # create the schema
npm run db:seed                # 12 starter Muses
npm run dev
```

`AUTH_SECRET` can be generated with `npx auth secret`.

### The local database

Development uses a Postgres cluster run directly from `pg_ctl`, no service and
no admin rights:

```
pg_ctl -D <datadir> -o "-p 5433" -l <datadir>/server.log start
```

It listens on loopback only with trust auth, which is fine for a local dev
database and is **not** how the deployed one is configured.

## Solo mode — no database

`/solo` is the whole product with no database and no account. All twelve
personas, conversations, memories and relationship continuity, held in the
browser's localStorage.

It still needs one server function, because the model API key must not be
shipped to the client (§50). `/api/solo/chat` and `/api/solo/remember` are
stateless: the client sends the persona, the recent turns and the memories it
wants used, and gets a stream back. The system prompt is still assembled
server-side (§33) so the endpoint cannot be pointed at arbitrary instructions.

Deploying solo mode needs **one** environment variable:

```
GEMINI_API_KEY=...
```

No database, no migrations, no AUTH_SECRET.

What it gives up is real: no account, so no second device, no recovery if the
browser is cleared, and nothing you can read back later for research. What it
keeps is the thing the product is for — personalities that remember you.

Memory retrieval there is lexical rather than semantic: embeddings would need a
round trip per turn, and `rankMemories` already falls back to lexical scoring
whenever a provider has no embedding model.

## Deploying

The app is stateless; everything lives in Postgres. Any host that runs Next.js
works, Vercel included.

1. **Provision a Postgres.** Neon, Supabase and Vercel Postgres all have free
   tiers. Copy the connection string.
2. **Set environment variables** on the host:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Postgres connection string |
   | `AUTH_SECRET` | yes | `npx auth secret` |
   | `GEMINI_API_KEY` | one of | with `GEMINI_MODEL` |
   | `ANTHROPIC_API_KEY` | one of | with `ANTHROPIC_MODEL` |
   | `LLM_PROVIDER` | if both | `gemini` or `anthropic` |
   | `EMBEDDING_MODEL` | no | defaults to `gemini-embedding-001` |

   `LLM_PROVIDER` is worth setting explicitly. Without it the provider is picked
   by which key exists, and a stale key left in the environment silently wins.

3. **Run migrations against the production database**, once, before the first
   deploy: `DATABASE_URL=<prod> npm run db:deploy`
4. **Deploy.** `npm run build` runs `prisma generate` first, because hosts cache
   `node_modules` and the generated client goes stale otherwise.
5. **Seed** if you want the starter Muses there: `DATABASE_URL=<prod> npm run db:seed`

Model API keys are server-side only and never reach the browser (§50). The
Gemini key travels as a header, never a query parameter, and provider errors are
redacted before they can be returned or logged.

## Testing

```
npm test          unit tests: SSE framing, memory ranking, prompt construction
npm run test:e2e  the §67 scenario against the real database and real model
npm run typecheck
```

`test:e2e` is the one that matters. It plays out the PRD's "most important
product test" — tell a Muse about an interview on day 1, come back on day 2,
report the outcome on day 4, and check the relationship still holds on day 7 —
and asserts memory is extracted, retrieved, gated for relevance, and genuinely
gone once deleted. It costs a few model calls.

## Notes on two decisions

**Memory relevance is judged relatively, not absolutely.** Measured on
`gemini-embedding-001`, any two short sentences score 0.50–0.65 whether they are
related or not; "what should I cook tonight" against "User has a job interview on
Friday" is 0.55. An absolute cosine threshold therefore admits everything or
nothing. Relevance is scored in standard deviations above the mean of that
query's own results, and a flat spread injects nothing — which is the correct
answer to a vague opener.

**Nothing is capped that Gemini spends reasoning against.** Gemini 3.x uses
300–1000 tokens thinking before it writes, and `maxOutputTokens` covers thinking
and output together. Capping it truncated replies mid-sentence and made memory
extraction return silently empty JSON. Calls are uncapped unless a limit is set
deliberately.

## Not built

Voice (§17), proactive messages and scheduling (§15), discovery search (§19),
subscriptions and entitlements (§39), analytics (§40). The schema has tables for
all of them, so adding each is a feature rather than a migration of live data.

Content moderation is a shallow keyword screen at persona creation
(`src/lib/muse/moderation.ts`). It catches the obvious and is not a substitute
for the classifier §36 asks for on creation, user messages and model output.
