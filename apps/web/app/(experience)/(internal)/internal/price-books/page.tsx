import {
  DatabasePriceBookAdministrationReader,
  DatabasePriceBookImpactReader,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { PriceBookAdministration } from "@/src/features/internal-ops/administration-safety/price-books";
import { loadPriceBookRecords } from "@/src/features/internal-ops/price-books/server-price-book-loader";
import { loadPriceBookImpact } from "@/src/features/internal-ops/price-books/server-price-book-impact-loader";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";

export const dynamic = "force-dynamic";

const serviceDatabase = getOptionalServiceDatabase();
const reader = serviceDatabase
  ? new DatabasePriceBookAdministrationReader(serviceDatabase)
  : undefined;

export default async function Page() {
  const [session, identity, priceBooks] = await Promise.all([
    getRouteSession("internal"),
    // The acting user decides which activation this reader may approve. The
    // server enforces the two-authority rule either way.
    getRouteIdentity("internal").catch(() => undefined),
    loadPriceBookRecords(reader),
  ]);
  const impact = await loadPriceBookImpact({
    reader: serviceDatabase
      ? new DatabasePriceBookImpactReader(serviceDatabase)
      : undefined,
    books: priceBooks.books,
    userId: identity?.userId ?? "",
    providerBacked: session.providerBacked,
    internalReader: session.roles.some(
      (role) => role === "finance_approver" || role === "internal_operator",
    ),
    demo: priceBooks.source === "Deterministic demo fixture",
    readAt: priceBooks.readAt,
  });
  return (
    <PriceBookAdministration
      roles={session.roles}
      userId={identity?.userId ?? ""}
      books={priceBooks.books}
      source={priceBooks.source}
      availability={priceBooks.availability}
      readAt={priceBooks.readAt}
      impact={impact}
    />
  );
}
