import "dotenv/config";
import { defineConfig } from "prisma/config";

/* Prisma 7 reads the connection URL from here rather than schema.prisma.
   The application itself connects through the driver adapter in src/lib/db.ts;
   this block exists so `prisma migrate` and `prisma studio` know where to go. */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
