import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import layout from "./channel-policy.module.css";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { DemoCommercialPolicyRepository } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import Link from "next/link";
import { DatabaseChannelPolicyRepository } from "@clockwork/db";
import {
  legacyChannelDefaults,
  type ChannelPolicyRecord,
  type ChannelPolicySnapshot,
} from "@clockwork/domain/core";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  AdministrationPage,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
import { ChannelDecisionForm, ChannelTermsForm } from "./forms";
export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required");
  let records: ChannelPolicyRecord[] = [];
  let active: ChannelPolicySnapshot = legacyChannelDefaults;
  let available = false;
  const database = getOptionalServiceDatabase();
  const demo = demoDeployIdentityEnabled(process.env);
  if (demo && session.roles.includes("finance_approver")) {
    const repo = new DemoCommercialPolicyRepository();
    [records, active] = await Promise.all([repo.listChannel(), repo.active()]);
    available = true;
  }
  if (
    !demo &&
    database &&
    session.providerBacked &&
    session.roles.includes("finance_approver")
  )
    try {
      const repo = new DatabaseChannelPolicyRepository(database);
      [records, active] = await Promise.all([repo.list(), repo.active()]);
      available = true;
    } catch {
      /* No fixture substitutes for an authoritative policy read. */
    }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <AdministrationPage
      eyebrow="Commercial controls"
      title="Channel policy"
      description="Configure sales handoff and requested registration protection. Policies need two finance users and apply only from their approved effective date."
      actions={
        <Link className={styles.buttonSecondary} href="/internal/price-books">
          Price books
        </Link>
      }
    >
      <div className={layout.workspace}>
        {demo ? (
          <p className={styles.notice}>
            Fictional policy workspace. Approval changes only this resettable
            demo. The seeded proposal has a different author for two-person
            review; live commercial policy and provider gates are unaffected.
          </p>
        ) : null}
        {!available ? (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <h2>Policy administration unavailable</h2>
              <p>
                Connect the control database and sign in with your finance
                identity. Demo personas cannot approve live policy.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.panelBody}>
                <div className={layout.cardHeading}>
                  <h2>Current controls</h2>
                  <StatusPill
                    state={
                      active.source === "approved_policy"
                        ? `Approved v${active.version}`
                        : "Legacy defaults"
                    }
                  />
                </div>
                <div className={layout.metrics}>
                  <div>
                    <span>Sales handoff</span>
                    <strong>
                      {active.selfServeThresholdTb} <small>TB</small>
                    </strong>
                    <p>Capacity routed to the full quote flow</p>
                  </div>
                  <div>
                    <span>Requested protection</span>
                    <strong>
                      {active.defaultProtectionDays} <small>days</small>
                    </strong>
                    <p>Default window for new registrations</p>
                  </div>
                </div>
                <p>
                  {active.source === "approved_policy"
                    ? `Approved policy v${active.version}.`
                    : "Legacy UI defaults apply until an approved policy becomes effective."}{" "}
                  Protection remains subject to the registration decision.
                  Prices, term minimums and external sales gates are separate.
                </p>
              </div>
            </section>
            {records.map((record) => (
              <section
                className={styles.panel}
                key={`${record.id}:${record.rowVersion}`}
              >
                <div className={styles.panelBody}>
                  <div className={layout.cardHeading}>
                    <h2>Policy version {record.terms.version}</h2>
                    <StatusPill state={record.status} />
                  </div>
                  <p>
                    Effective {record.terms.effectiveFrom} UTC; supersedes
                    earlier effective policies for new requests.
                  </p>
                  <dl className={layout.facts}>
                    <dt>Sales handoff</dt>
                    <dd>{record.terms.selfServeThresholdTb} TB</dd>
                    <dt>Requested protection</dt>
                    <dd>
                      {record.terms.defaultProtectionDays} days by default;
                      maximum {record.terms.maximumProtectionDays} days
                    </dd>
                    <dt>Extensions</dt>
                    <dd>
                      Up to {record.terms.maximumExtensions}, each at most{" "}
                      {record.terms.extensionDays} days with recorded progress
                    </dd>
                    <dt>Source</dt>
                    <dd>{record.terms.sourceEvidence}</dd>
                  </dl>
                  {record.decisionReason ? (
                    <p className={layout.decisionNote}>
                      <strong>Decision</strong> {record.decisionReason}
                    </p>
                  ) : null}
                  {record.status === "draft" ? (
                    <>
                      <details className={layout.disclosure}>
                        <summary>Edit this draft</summary>
                        <ChannelTermsForm
                          current={record}
                          nextVersion={record.terms.version}
                          today={today}
                        />
                      </details>
                      <ChannelDecisionForm
                        record={record}
                        action="propose"
                        allowed
                      />
                    </>
                  ) : record.status === "proposed" ? (
                    <div className={layout.decisions}>
                      <ChannelDecisionForm
                        record={record}
                        action="approve"
                        allowed={
                          ![
                            record.createdBy,
                            record.lastEditedBy,
                            record.proposedBy,
                          ].includes(session.userId)
                        }
                      />
                      <ChannelDecisionForm
                        record={record}
                        action="reject"
                        allowed={
                          ![
                            record.createdBy,
                            record.lastEditedBy,
                            record.proposedBy,
                          ].includes(session.userId)
                        }
                      />
                    </div>
                  ) : (
                    <p>
                      Approved content and existing registration snapshots are
                      immutable. Publish a new version to change future
                      requests.
                    </p>
                  )}
                </div>
              </section>
            ))}
            <section className={styles.panel}>
              <div className={styles.panelBody}>
                <ChannelTermsForm
                  nextVersion={
                    Math.max(
                      0,
                      ...records.map((record) => record.terms.version),
                    ) + 1
                  }
                  today={today}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </AdministrationPage>
  );
}
