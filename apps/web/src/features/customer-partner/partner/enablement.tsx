import Link from "next/link";

import {
  clientSafeEnablementItems,
  internalEnablementItems,
  type EnablementItem,
} from "./enablement-data";
import styles from "./enablement.module.css";

function EnablementLedger({
  items,
  label,
}: {
  items: readonly EnablementItem[];
  label: string;
}) {
  return (
    <ul className={styles.ledger} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
          <Link href={item.href}>Open</Link>
        </li>
      ))}
    </ul>
  );
}

export function PartnerEnablement({
  roles,
  partnerName,
}: {
  roles: readonly string[];
  partnerName: string;
}) {
  const clientSafe = clientSafeEnablementItems();
  const internal = internalEnablementItems(roles);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>Partner enablement</h1>
        <p>
          Reach approved product destinations from {partnerName}, with the
          client-sharing boundary kept separate from partner-account work.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="share-with-clients">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="share-with-clients">Share with clients</h2>
            <p>
              Public destinations a client can open outside the partner desk.
            </p>
          </div>
          <span>{clientSafe.length} destinations</span>
        </div>
        <p className={styles.boundary}>
          Nothing in this section exposes transfer pricing, commissions, deal
          registrations, or other partner-account records.
        </p>
        <EnablementLedger items={clientSafe} label="Client-safe destinations" />
      </section>

      <aside className={styles.salesKit} aria-labelledby="sales-kit-v1">
        <p>Not published</p>
        <h2 id="sales-kit-v1">Sales Kit v1</h2>
        <p>
          Approved client decks, email templates, and objection guides have not
          been published. Nothing on this page is a placeholder for that
          content.
        </p>
      </aside>

      <section className={styles.section} aria-labelledby="internal-to-desk">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="internal-to-desk">Internal to your desk</h2>
            <p>
              Account-scoped partner motions available to your current role.
            </p>
          </div>
          <span>{internal.length} motions</span>
        </div>
        <EnablementLedger items={internal} label="Partner desk motions" />
      </section>
    </main>
  );
}
