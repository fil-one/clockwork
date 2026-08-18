import { DatabasePriceBookAdministrationReader } from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { PriceBookAdministration } from "@/src/features/internal-ops/administration-safety/price-books";
import { loadPriceBookRecords } from "@/src/features/internal-ops/price-books/server-price-book-loader";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";

export const dynamic = "force-dynamic";

const serviceDatabase = getOptionalServiceDatabase();
const reader = serviceDatabase
  ? new DatabasePriceBookAdministrationReader(serviceDatabase)
  : undefined;

export default async function Page() {
  const [roles, identity, priceBooks] = await Promise.all([
    getRouteRoles("internal"),
    // The acting user decides which activation this reader may approve. The
    // server enforces the two-authority rule either way.
    getRouteIdentity("internal").catch(() => undefined),
    loadPriceBookRecords(reader),
  ]);
  return (
    <PriceBookAdministration
      roles={roles}
      userId={identity?.userId ?? ""}
      books={priceBooks.books}
      source={priceBooks.source}
      availability={priceBooks.availability}
      readAt={priceBooks.readAt}
    />
  );
}
