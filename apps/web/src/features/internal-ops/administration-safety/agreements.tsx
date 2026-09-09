"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import { useMemo, useState, type ReactNode } from "react";

import { Table } from "@clockwork/ui";

import { adminSafetyCopy } from "./copy";
import { agreementVersions } from "./data";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

export function AgreementAdministration({
  roles,
  publishAction,
  readOnly = false,
}: {
  roles: readonly string[];
  readOnly?: boolean;
  /**
   * The authorized template publication workflow this review hands off to,
   * supplied by the route so it carries the route's own permission gate.
   */
  publishAction?: ReactNode;
}) {
  const t = useTranslations();
  const localizedadminSafetyCopy = localizeCopy(adminSafetyCopy, t);
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState("All");
  const [state, setState] = useState("All");
  const [selectedId, setSelectedId] = useState(
    agreementVersions.find((version) => version.state === "Draft")?.id ??
      agreementVersions[0]?.id ??
      "",
  );
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const permitted = canDecide(roles, "legal");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agreementVersions.filter(
      (version) =>
        (jurisdiction === "All" || version.jurisdiction === jurisdiction) &&
        (state === "All" || version.state === state) &&
        (!needle ||
          [
            version.label,
            version.type,
            version.version,
            version.jurisdiction,
            version.execution,
            version.scan,
          ].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [jurisdiction, query, state]);
  const selected =
    agreementVersions.find((version) => version.id === selectedId) ??
    agreementVersions[0];

  if (!selected) return null;

  return (
    <AdministrationPage {...localizedadminSafetyCopy.agreements}>
      <section
        className={styles.panel}
        aria-labelledby="agreement-versions-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="agreement-versions-title">Version scan</h2>
            <p>Canonical records only · Updated Jul 31, 2026 at 11:44 AM EDT</p>
          </div>
          <StatusPill state="Fresh" />
        </div>
        <div
          className={styles.toolbar}
          role="search"
          aria-label="Agreement version filters"
        >
          <label className={styles.field}>
            Search templates
            <input
              type="search"
              value={query}
              placeholder="Name, version, jurisdiction, or scan state"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            Jurisdiction
            <select
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.currentTarget.value)}
            >
              <option>{t("ui.113")}</option>
              <option>United States</option>
              <option>European Union</option>
              <option>United Kingdom</option>
            </select>
          </label>
          <label className={styles.field}>
            State
            <select
              value={state}
              onChange={(event) => setState(event.currentTarget.value)}
            >
              <option>{t("ui.113")}</option>
              <option>{t("status.active")}</option>
              <option>Approved</option>
              <option>{t("status.draft")}</option>
              <option>Retired</option>
            </select>
          </label>
        </div>
        <p className={styles.resultMeta} aria-live="polite">
          {filtered.length} of {agreementVersions.length} versions · Sorted by
          effective date, newest first
        </p>
        <Table
          className={styles.scanTable ?? ""}
          caption="Agreement template versions and approval scan state"
          captionHidden
          density="compact"
          headers={[
            "Template",
            "Version",
            "Jurisdiction",
            "Execution",
            "Effective",
            "State",
            "Scan",
          ]}
          rowKeys={filtered.map((version) => version.id)}
          rows={filtered.map((version) => [
            <span className={styles.stackCell}>
              <strong>{version.label}</strong>
              <small>{version.type}</small>
            </span>,
            version.version,
            version.jurisdiction,
            version.execution,
            version.effectiveOn,
            <StatusPill state={version.state} />,
            <span className={styles.stackCell}>
              <strong>{version.scan}</strong>
              <small>Exact-text evidence retained</small>
            </span>,
          ])}
          emptyState="No agreement versions match these filters."
        />
      </section>

      <section
        className={styles.panel}
        aria-labelledby="agreement-review-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="agreement-review-title">Legal activation review</h2>
            <p>
              Publication preserves version, exact text, approval evidence, and
              prior executions.
            </p>
          </div>
          <StatusPill state={permitted ? "Legal authority" : "Read only"} />
        </div>
        <form
          className={styles.panelBody}
          onSubmit={(event) => {
            event.preventDefault();
            setSummary(
              buildReviewSummary({
                entity: `${selected.label} v${selected.version} · ${selected.jurisdiction}`,
                impact:
                  "Makes this immutable, counsel-approved template eligible for activation on its effective date.",
                evidence: [
                  selected.scan,
                  `Exact approved text hash: ${selected.textHash}`,
                  `Execution mode: ${selected.execution}`,
                ],
                policyBasis:
                  "Agreement policy AG-2 requires counsel authority, semantic versioning, exact-text hashing, and canonical-document evidence.",
                downstreamEffect:
                  "New eligible executions resolve to this version. Existing signed agreements and domain rules are unchanged.",
                reason,
              }),
            );
          }}
        >
          <HumanSelector
            label="Agreement template"
            name="agreementTemplateId"
            options={agreementVersions.map((version) => ({
              ...version,
              label: `${version.label} v${version.version}`,
              description: `${version.jurisdiction} · ${version.state}`,
            }))}
            value={selectedId}
            onChange={(id) => {
              if (id) setSelectedId(id);
              setReason("");
              setSummary(null);
            }}
          />
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("ui.122")}</dt>
              <dd>
                {selected.version} · {selected.state}
              </dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{selected.effectiveOn}</dd>
            </div>
            <div>
              <dt>Approval scan</dt>
              <dd>{selected.scan}</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>{selected.execution}</dd>
            </div>
          </dl>
          {!readOnly ? (
            <label className={styles.field}>
              Counsel decision reason
              <textarea
                value={reason}
                required
                minLength={8}
                placeholder="Explain why this exact version is approved for publication."
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setSummary(null);
                }}
              />
            </label>
          ) : null}
          <TechnicalEvidence
            identifiers={[
              { label: "Template ID", value: selected.id },
              { label: "Exact text hash", value: selected.textHash },
            ]}
          />
          {readOnly ? (
            <div className={styles.roleNotice} role="note">
              <strong>Template evidence is read only in this demo.</strong>
              Publication needs counsel-approved canonical text and approval
              evidence from the production agreement registry.
            </div>
          ) : !permitted ? (
            <div className={styles.roleNotice} role="note">
              <strong>Legal approval authority is required.</strong>
              Other internal roles may scan versions and evidence but cannot
              approve or activate a template.
            </div>
          ) : null}
          {!readOnly ? (
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!permitted}
              >
                Review template approval
              </button>
            </div>
          ) : null}
        </form>
      </section>

      {summary && !readOnly ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title="Agreement publication review"
            identifiers={[
              { label: "Template ID", value: selected.id },
              { label: "Exact text hash", value: selected.textHash },
            ]}
          />
          <section className={styles.handoff} role="note">
            <strong>Not published</strong>
            <p>
              Publish through the template workflow. Counsel authority, exact
              text hash, approval evidence, and effective date are verified
              there.
            </p>
          </section>
        </>
      ) : null}

      {publishAction}
    </AdministrationPage>
  );
}
