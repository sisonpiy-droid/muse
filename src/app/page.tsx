import { redirect } from "next/navigation";

/* The root chooses which MUSE this deployment is.
 *
 * With a database configured, it serves the full product: accounts, shared
 * Muses, memory in Postgres. Without one, there is nothing for the signed-in
 * app to talk to, so it hands over to solo mode rather than throwing a 500 at
 * whoever opened the link.
 *
 * The import is dynamic on purpose. `@/lib/db` constructs a Prisma client at
 * module scope, so a static import would pull it into the graph — and fail on
 * load — even on a deployment that never intended to use it.
 */

export default async function RootPage() {
  if (!process.env.DATABASE_URL) redirect("/solo");

  const { default: DatabaseHome } = await import("./home-db");
  return <DatabaseHome />;
}
