// i18n-exempt-file: English projection strings for consumers that do not render commercial facts yet (the dashboard loader requires them); every commercial surface renders the facts in the reader's language, and projection-compat.test.ts holds each string equal to the English rendering of its record's facts.

/**
 * The display strings a commercial projection row has always carried, for the
 * demo fixtures in `model.ts`.
 *
 * They are not the source of anything. Each one is the English rendering of
 * the fixture's `facts` -- the test beside this file fails the moment the two
 * differ -- and they exist only because projection consumers outside the
 * commercial surfaces (`dashboard-loader.ts`, and the required fields of the
 * portal loader's `commercialRecord`) read these strings rather than the
 * facts. A surface that has the facts renders them for its reader; delete a
 * field here once nothing reads it.
 */
export interface ProjectionCompatStrings {
  readonly description: string;
  readonly statusLabel: string;
  readonly value: string;
  readonly valueLabel: string;
  readonly dateLabel: string;
  readonly term: string;
  readonly nextAction: string;
}

export const projectionCompat: Readonly<
  Record<string, ProjectionCompatStrings>
> = {
  "AGR-2026-0042": {
    description: "Fil One paper · signed",
    statusLabel: "Active",
    value: "Dec 31, 2026",
    valueLabel: "Term end",
    dateLabel: "Updated Jul 30, 2026",
    term: "Jan 1 – Dec 31, 2026 · notice opens Nov 1, 2026",
    nextAction: "No action due",
  },
  "AGR-2026-0061": {
    description: "Customer paper · four key terms in legal review",
    statusLabel: "Review required",
    value: "Aug 5, 2026",
    valueLabel: "Response due",
    dateLabel: "Updated Jul 31, 2026",
    term: "Pending execution",
    nextAction: "Review negotiated terms",
  },
  "AGR-2026-0017": {
    description: "EU variant · attached to the governing agreement",
    statusLabel: "Active",
    value: "Jun 30, 2027",
    valueLabel: "Term end",
    dateLabel: "Updated Jul 28, 2026",
    term: "Co-terminous with the Cloud Service Agreement",
    nextAction: "No action due",
  },
  "Q-2026-0184-v3": {
    description: "400 TB · US East · annual · direct",
    statusLabel: "Open",
    value: "$184,800.00",
    valueLabel: "Estimated annual spend",
    dateLabel: "Expires Aug 4, 2026",
    term: "12 months · expires Aug 4, 2026",
    nextAction: "Accept or cancel before expiry",
  },
  "Q-2026-0171-v1": {
    description: "80 TB · EU West · monthly commit · direct",
    statusLabel: "Draft",
    value: "€31,680.00",
    valueLabel: "Estimated annual spend",
    dateLabel: "Updated Jul 29, 2026",
    term: "12 months · expiry set when issued",
    nextAction: "Finish and issue quote",
  },
  "Q-2026-0165-v2": {
    description: "120 TB · UK South · annual · direct",
    statusLabel: "Accepted",
    value: "$55,440.00",
    valueLabel: "Accepted estimated spend",
    dateLabel: "Accepted Jul 25, 2026",
    term: "12 months · accepted Jul 25, 2026",
    nextAction: "Review and accept resulting order",
  },
  "Q-2026-0140-v1": {
    description: "40 TB · US East · three months · direct",
    statusLabel: "Canceled",
    value: "$4,620.00",
    valueLabel: "Canceled estimate",
    dateLabel: "Canceled Jul 18, 2026",
    term: "Canceled before acceptance",
    nextAction: "No actions available",
  },
  "ORD-2026-0098": {
    description: "500 TB · US East · direct · PO-NA-1048",
    statusLabel: "Active",
    value: "$184,800.00",
    valueLabel: "Committed annual spend",
    dateLabel: "Started Jan 1, 2026",
    term: "Jan 1 – Dec 31, 2026 · auto-renews",
    nextAction: "Renewal notice opens Nov 1, 2026",
  },
  "ORD-2026-0112": {
    description: "120 TB · EU West · direct · PO-NA-1081",
    statusLabel: "Provisioning",
    value: "$55,440.00",
    valueLabel: "Committed annual spend",
    dateLabel: "Starts Aug 1, 2026",
    term: "Aug 1, 2026 – Jul 31, 2027",
    nextAction: "Complete provisioning checklist",
  },
  "SVC-PRIMARY-01": {
    description: "500 TB committed · 311 TB stored · US East",
    statusLabel: "Active",
    value: "62% used",
    valueLabel: "Capacity usage",
    dateLabel: "Metered Jul 31, 2026",
    term: "Ends Dec 31, 2026",
    nextAction: "No action due",
  },
  "SVC-REPLICA-02": {
    description: "120 TB committed · provisioning at 78% · EU West",
    statusLabel: "Provisioning",
    value: "78% ready",
    valueLabel: "Provisioning",
    dateLabel: "Updated Jul 31, 2026",
    term: "Starts Aug 1, 2026",
    nextAction: "Confirm encryption key handoff",
  },
  "POC-2026-0031": {
    description: "20 TB cap · confidential data permitted",
    statusLabel: "Active",
    value: "7 days left",
    valueLabel: "Time remaining",
    dateLabel: "Expires Aug 7, 2026",
    term: "Expires Aug 7, 2026 · isolated environment",
    nextAction: "Complete restore validation",
  },
  "POC-2026-0024": {
    description: "12 TB · four of four success tests passed",
    statusLabel: "Complete",
    value: "Ready to convert",
    valueLabel: "Outcome",
    dateLabel: "Completed Jul 27, 2026",
    term: "Evaluation complete · data retained in place",
    nextAction: "Review paid conversion",
  },
  "INV-2026-0781": {
    description: "Invoice for Northstar primary archive · PO-NA-1048",
    statusLabel: "Open",
    value: "$15,400.00",
    valueLabel: "Invoiced amount",
    dateLabel: "Due Aug 8, 2026",
    term: "Service period Jul 1 – 31, 2026",
    nextAction: "Review and pay by Aug 8, 2026",
  },
  "INV-2026-0712": {
    description: "Receipt RCPT-2026-0712 · ACH ending 1842",
    statusLabel: "Paid",
    value: "$15,400.00",
    valueLabel: "Invoiced amount",
    dateLabel: "Provider confirmed Jul 3, 2026",
    term: "Service period Jun 1 – 30, 2026",
    nextAction: "No action due",
  },
};
