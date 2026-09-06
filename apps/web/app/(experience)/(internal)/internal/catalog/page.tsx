import Link from "next/link";
import { DatabaseCatalogAdmin } from "@clockwork/db";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  AdministrationPage,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { CatalogMappingControls } from "./controls";

export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required");
  let rows: Awaited<ReturnType<DatabaseCatalogAdmin["list"]>> | null = null;
  try {
    const db = getOptionalServiceDatabase();
    if (db && session.providerBacked)
      rows = await new DatabaseCatalogAdmin(db).list(
        `catalog:${crypto.randomUUID()}`,
      );
  } catch {
    rows = null;
  }
  const canEdit = session.roles.some(
    (role) => role === "internal_operator" || role === "finance_approver",
  );
  return (
    <AdministrationPage
      title="Catalog and provider mappings"
      eyebrow="Commercial administration"
      description="Inspect catalog versions and prepare the provisionable SKU, region and source meter for each draft rate."
    >
      <p>
        <Link className={styles.proseLink} href="/internal/price-books">
          Manage SKUs, regions, rates and price-book approval
        </Link>
        . Mapping evidence records supplied references; it does not certify a
        live provider or enable sales.{" "}
        <Link className={styles.proseLink} href="/internal/gates">
          Review provider qualification gates
        </Link>
        .
      </p>
      {rows === null ? (
        <p role="status">
          {session.providerBacked
            ? "Catalog registry unavailable. Check the control database connection and try again."
            : "Live provider mappings are not connected in this demo. Use Price books to explore fictional SKUs, regions and pricing. Mapping administration requires a verified staff session and the control database."}
        </p>
      ) : rows.length === 0 ? (
        <p>
          No catalog rates exist. Create an initial draft using the safe
          production bootstrap or the price-book editor.
        </p>
      ) : (
        rows.map((row) => (
          <section className={styles.panel} key={row.rateCardId}>
            <div className={styles.panelHeading}>
              <div>
                <h2>
                  {row.sku} · {row.region}
                </h2>
                <p>
                  {row.bookName} v{row.bookVersion} · {row.unit}
                </p>
              </div>
              <StatusPill state={row.status} />
            </div>
            <div className={styles.panelBody}>
              <p>{row.approvedClaim}</p>
              {row.mapping ? (
                <dl>
                  <dt>Provider SKU / region</dt>
                  <dd>
                    {row.mapping.providerSku} / {row.mapping.providerRegion}
                  </dd>
                  <dt>Source meter</dt>
                  <dd>{row.mapping.meterId}</dd>
                  <dt>Source evidence</dt>
                  <dd>{row.mapping.sourceEvidence}</dd>
                </dl>
              ) : (
                <p>
                  No valid provisionable mapping is retained. This entry is not
                  provider-qualified.
                </p>
              )}
              {!row.editable ? (
                <p>
                  Mapping frozen by publication or a pending approval. Prepare
                  changes in a new draft version.
                </p>
              ) : null}
            </div>
            {row.editable && canEdit ? (
              <CatalogMappingControls
                key={`${row.rateCardId}:${row.rowVersion}`}
                row={row}
              />
            ) : null}
          </section>
        ))
      )}
    </AdministrationPage>
  );
}
