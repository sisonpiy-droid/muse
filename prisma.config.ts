import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/* Next.js reads .env.local automatically; the Prisma CLI does not, and
   dotenv/config only picks up .env. Load both, local last so it wins, which
   matches the precedence the app itself uses. */
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

/* Prisma 7 reads the connection URL from here rather than schema.prisma. The
   app connects through the driver adapter in src/lib/db.ts; this exists so
   `prisma migrate` and `prisma studio` know where to go. */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
