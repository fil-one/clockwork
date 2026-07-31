import React from "react";

import { englishDocumentMessages as copy, documentTitles } from "./messages";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercentFromBasisPoints,
  formatPeriod,
} from "./format";
import type {
  AmendmentDocumentInput,
  CommerceDocumentInput,
  CommissionStatementDocumentInput,
  DeletionCertificateDocumentInput,
  DocumentLineItem,
  DocumentTotals,
  InvoiceDocumentInput,
  OrderFormDocumentInput,
  PocDocumentInput,
  QuoteDocumentInput,
  RenewalConfirmationDocumentInput,
  ReportDocumentInput,
} from "./model";
import {
  BrandedDocument,
  BulletList,
  DataTable,
  DocumentSection,
  KeyValueGrid,
  Parties,
  styles,
  Text,
  View,
} from "./template";
import type { TableColumn, TableRowData } from "./template";

const LINE_ITEM_COLUMNS: readonly TableColumn[] = [
  { label: copy.item, width: "43%" },
  { align: "right", label: copy.quantity, width: "15%" },
  { align: "right", label: copy.unitPrice, width: "20%" },
  { align: "right", label: copy.amount, width: "22%" },
];

function tableCell(value: string, detail?: string) {
  return detail ? { detail, value } : { value };
}

function LineItems({
  items,
  locale,
}: {
  items: readonly DocumentLineItem[];
  locale: QuoteDocumentInput["locale"];
}) {
  const rows: readonly TableRowData[] = items.map((item) => ({
    cells: [
      tableCell(item.description, item.detail),
      tableCell(item.quantity ?? "-", item.unitLabel),
      tableCell(item.unitPrice ? formatMoney(item.unitPrice, locale) : "-"),
      tableCell(formatMoney(item.amount, locale), item.taxLabel),
    ],
    id: item.id,
  }));

  return <DataTable columns={LINE_ITEM_COLUMNS} rows={rows} />;
}

function Totals({
  totals,
  locale,
}: {
  totals: DocumentTotals;
  locale: QuoteDocumentInput["locale"];
}) {
  return (
    <View style={styles.totals} wrap={false}>
      <View style={styles.totalsRow}>
        <Text>{copy.subtotal}</Text>
        <Text>{formatMoney(totals.subtotal, locale)}</Text>
      </View>
      {totals.discount ? (
        <View style={styles.totalsRow}>
          <Text>{copy.discount}</Text>
          <Text>{formatMoney(totals.discount, locale)}</Text>
        </View>
      ) : null}
      {totals.tax ? (
        <View style={styles.totalsRow}>
          <Text>{totals.taxLabel ?? copy.tax}</Text>
          <Text>{formatMoney(totals.tax, locale)}</Text>
        </View>
      ) : null}
      <View style={styles.totalsGrand}>
        <Text>{copy.total}</Text>
        <Text>{formatMoney(totals.total, locale)}</Text>
      </View>
    </View>
  );
}

function QuoteDocument({ input }: { input: QuoteDocumentInput }) {
  const title = documentTitles[input.kind];
  const metadata = [
    { label: copy.quoteReference, value: input.quoteNumber },
    {
      label: copy.validUntil,
      value: formatDate(input.validUntil, input.locale),
    },
    { label: copy.currency, value: input.currency },
    { label: copy.paymentTerms, value: input.paymentTerms },
    ...(input.servicePeriod
      ? [
          {
            label: copy.servicePeriod,
            value: formatPeriod(input.servicePeriod, input.locale),
          },
        ]
      : []),
    ...(input.agreementReference
      ? [
          {
            label: copy.agreementReference,
            value: input.agreementReference,
          },
        ]
      : []),
  ];

  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.quoteNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.preparedFor}
      />
      <KeyValueGrid items={metadata} />

      {input.endClient ? (
        <DocumentSection keepTogether title={copy.endClient}>
          <Text style={styles.body}>{input.endClient.legalName}</Text>
        </DocumentSection>
      ) : null}

      <DocumentSection title={copy.summary}>
        <LineItems items={input.lineItems} locale={input.locale} />
        <Totals locale={input.locale} totals={input.totals} />
      </DocumentSection>

      {input.purchaseOrderRequired ? (
        <View style={styles.cardMuted} wrap={false}>
          <Text style={styles.body}>{copy.purchaseOrderRequired}</Text>
        </View>
      ) : null}

      {input.commercialTerms && input.commercialTerms.length > 0 ? (
        <DocumentSection keepTogether title={copy.commercialTerms}>
          <BulletList items={input.commercialTerms} />
        </DocumentSection>
      ) : null}
    </BrandedDocument>
  );
}

function OrderFormDocument({ input }: { input: OrderFormDocumentInput }) {
  const title = documentTitles[input.kind];
  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.orderNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.preparedFor}
      />
      <KeyValueGrid
        items={[
          { label: copy.orderReference, value: input.orderNumber },
          { label: copy.quoteReference, value: input.quoteReference },
          {
            label: copy.governingAgreement,
            value: input.governingAgreementReference,
          },
          {
            label: copy.servicePeriod,
            value: formatPeriod(input.servicePeriod, input.locale),
          },
          {
            label: copy.purchaseOrder,
            value: input.purchaseOrderNumber ?? "-",
          },
          { label: copy.paymentTerms, value: input.paymentTerms },
        ]}
      />
      <DocumentSection title={copy.summary}>
        <LineItems items={input.lineItems} locale={input.locale} />
        <Totals locale={input.locale} totals={input.totals} />
      </DocumentSection>
      <DocumentSection keepTogether title={copy.confirmation}>
        <View style={styles.cardMuted}>
          <KeyValueGrid
            items={[
              {
                label: copy.recordedBy,
                value: `${input.signer.name}, ${input.signer.title}`,
              },
              {
                label: copy.completedAt,
                value: formatDateTime(input.signer.acceptedAt, input.locale),
              },
              {
                label: copy.authorityAttestation,
                value: input.signer.authorityAttestation,
              },
            ]}
          />
        </View>
      </DocumentSection>
    </BrandedDocument>
  );
}

function AmendmentDocument({ input }: { input: AmendmentDocumentInput }) {
  const title = documentTitles[input.kind];
  const columns: readonly TableColumn[] = [
    { label: copy.change, width: "13%" },
    { label: copy.item, width: "47%" },
    { align: "right", label: copy.quantity, width: "17%" },
    { align: "right", label: copy.lineNet, width: "23%" },
  ];
  const rows: readonly TableRowData[] = input.deltaLines.map((line) => ({
    cells: [
      { value: line.change.toUpperCase() },
      tableCell(line.description, line.detail),
      tableCell(line.quantity ?? "-", line.unitLabel),
      { value: formatMoney(line.amount, input.locale) },
    ],
    id: line.id,
  }));

  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.amendmentNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.preparedFor}
      />
      <KeyValueGrid
        items={[
          { label: copy.amendment, value: input.amendmentNumber },
          { label: copy.parentOrder, value: input.parentOrderReference },
          {
            label: copy.governingAgreement,
            value: input.governingAgreementReference,
          },
          {
            label: copy.effectiveDate,
            value: formatDate(input.effectiveDate, input.locale),
          },
          { label: copy.prorationMethod, value: input.prorationMethod },
          ...(input.resultingTerm
            ? [
                {
                  label: copy.resultingTerm,
                  value: formatPeriod(input.resultingTerm, input.locale),
                },
              ]
            : []),
        ]}
      />
      <DocumentSection title={copy.change}>
        <DataTable columns={columns} rows={rows} />
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsGrand}>
            <Text>{copy.netChange}</Text>
            <Text>{formatMoney(input.netChange, input.locale)}</Text>
          </View>
        </View>
      </DocumentSection>
      {input.acceptedBy ? (
        <DocumentSection keepTogether title={copy.confirmation}>
          <KeyValueGrid
            items={[
              {
                label: copy.recordedBy,
                value: `${input.acceptedBy.name}, ${input.acceptedBy.title}`,
              },
              {
                label: copy.completedAt,
                value: formatDateTime(
                  input.acceptedBy.acceptedAt,
                  input.locale,
                ),
              },
            ]}
          />
        </DocumentSection>
      ) : null}
    </BrandedDocument>
  );
}

function PocDocument({ input }: { input: PocDocumentInput }) {
  const title = documentTitles[input.kind];
  const successColumns: readonly TableColumn[] = [
    { label: copy.successTests, width: "37%" },
    { label: copy.target, width: "25%" },
    { label: copy.observed, width: "25%" },
    { label: copy.result, width: "13%" },
  ];
  const successRows: readonly TableRowData[] = input.successTests.map(
    (test) => ({
      cells: [
        { value: test.label },
        { value: test.target },
        { value: test.observed ?? "-" },
        { value: test.result.replace("_", " ").toUpperCase() },
      ],
      id: test.id,
    }),
  );

  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.pocNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.shipTo}
        recipient={input.recipient}
        recipientLabel={copy.billTo}
      />
      <KeyValueGrid
        items={[
          { label: copy.pocReference, value: input.pocNumber },
          { label: copy.workload, value: input.workload },
          { label: copy.status, value: input.status },
          { label: copy.pocOwner, value: input.ownerName },
          {
            label: copy.servicePeriod,
            value: formatPeriod(input.servicePeriod, input.locale),
          },
          { label: copy.permittedData, value: input.permittedDataClass },
          { label: copy.capacityCap, value: input.capacityCap },
          { label: copy.egressCap, value: input.egressCap },
        ]}
      />
      {input.metrics && input.metrics.length > 0 ? (
        <DocumentSection title={copy.summary}>
          <KeyValueGrid
            items={input.metrics.map((metric) => ({
              label: metric.label,
              value: metric.context
                ? `${metric.value} (${metric.context})`
                : metric.value,
            }))}
          />
        </DocumentSection>
      ) : null}
      <DocumentSection title={copy.successTests}>
        <DataTable columns={successColumns} rows={successRows} />
      </DocumentSection>
      {input.outcome ? (
        <DocumentSection keepTogether title={copy.outcome}>
          <Text style={styles.body}>{input.outcome}</Text>
        </DocumentSection>
      ) : null}
      {input.recommendation ? (
        <DocumentSection keepTogether title={copy.recommendation}>
          <View style={styles.cardMuted}>
            <Text style={styles.body}>{input.recommendation}</Text>
          </View>
        </DocumentSection>
      ) : null}
    </BrandedDocument>
  );
}

function InvoiceDocument({ input }: { input: InvoiceDocumentInput }) {
  const title = documentTitles[input.kind];
  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.invoiceNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.billTo}
      />
      <KeyValueGrid
        items={[
          { label: copy.invoiceNumber, value: input.invoiceNumber },
          { label: copy.orderReference, value: input.orderReference },
          {
            label: copy.purchaseOrder,
            value: input.purchaseOrderNumber ?? "-",
          },
          ...(input.dueDate
            ? [
                {
                  label: copy.dueDate,
                  value: formatDate(input.dueDate, input.locale),
                },
              ]
            : []),
          ...(input.paidAt
            ? [
                {
                  label: copy.paidAt,
                  value: formatDateTime(input.paidAt, input.locale),
                },
              ]
            : []),
          ...(input.paymentReference
            ? [{ label: copy.paymentReference, value: input.paymentReference }]
            : []),
          ...(input.paymentMethod
            ? [{ label: copy.paymentMethod, value: input.paymentMethod }]
            : []),
        ]}
      />
      <DocumentSection title={copy.summary}>
        <LineItems items={input.lineItems} locale={input.locale} />
        <Totals locale={input.locale} totals={input.totals} />
      </DocumentSection>
      <DocumentSection keepTogether title={copy.paymentStatus}>
        <View style={styles.cardMuted}>
          <KeyValueGrid
            items={[
              {
                label: copy.amountPaid,
                value: formatMoney(input.amountPaid, input.locale),
              },
              {
                label: copy.balanceDue,
                value: formatMoney(input.balanceDue, input.locale),
              },
            ]}
          />
        </View>
      </DocumentSection>
    </BrandedDocument>
  );
}

function CommissionStatementDocument({
  input,
}: {
  input: CommissionStatementDocumentInput;
}) {
  const title = documentTitles[input.kind];
  const columns: readonly TableColumn[] = [
    { label: copy.endClient, width: "25%" },
    { label: copy.sourceInvoice, width: "16%" },
    { align: "right", label: copy.collectedRevenue, width: "17%" },
    { align: "right", label: copy.commissionRate, width: "10%" },
    { align: "right", label: copy.earned, width: "16%" },
    { align: "right", label: copy.adjustment, width: "16%" },
  ];
  const rows: readonly TableRowData[] = input.lines.map((line) => ({
    cells: [
      { value: line.endClientName },
      { value: line.invoiceReference },
      { value: formatMoney(line.collectedRevenue, input.locale) },
      {
        value: formatPercentFromBasisPoints(
          line.commissionRateBasisPoints,
          input.locale,
        ),
      },
      tableCell(formatMoney(line.earned, input.locale)),
      tableCell(
        line.adjustment
          ? formatMoney(line.adjustment, input.locale)
          : formatMoney(
              { currency: line.earned.currency, minorUnits: "0" },
              input.locale,
            ),
        line.adjustmentReason,
      ),
    ],
    id: line.id,
  }));

  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.statementNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.preparedFor}
      />
      <KeyValueGrid
        items={[
          { label: copy.documentId, value: input.statementNumber },
          {
            label: copy.period,
            value: formatPeriod(input.period, input.locale),
          },
          { label: copy.paymentStatus, value: input.paymentStatus },
        ]}
      />
      <DocumentSection title={copy.summary}>
        <DataTable columns={columns} rows={rows} />
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsRow}>
            <Text>{copy.grossCommission}</Text>
            <Text>{formatMoney(input.grossCommission, input.locale)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>{copy.clawbacks}</Text>
            <Text>{formatMoney(input.clawbacks, input.locale)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>{copy.holdback}</Text>
            <Text>{formatMoney(input.holdback, input.locale)}</Text>
          </View>
          <View style={styles.totalsGrand}>
            <Text>{copy.netPayable}</Text>
            <Text>{formatMoney(input.netPayable, input.locale)}</Text>
          </View>
        </View>
      </DocumentSection>
    </BrandedDocument>
  );
}

function RenewalConfirmationDocument({
  input,
}: {
  input: RenewalConfirmationDocumentInput;
}) {
  const title = documentTitles[input.kind];
  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.confirmationNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.from}
        recipient={input.recipient}
        recipientLabel={copy.preparedFor}
      />
      <KeyValueGrid
        items={[
          { label: copy.confirmation, value: input.confirmationNumber },
          { label: copy.orderReference, value: input.orderReference },
          { label: copy.agreementReference, value: input.agreementReference },
          {
            label: copy.currentTerm,
            value: formatPeriod(input.currentTerm, input.locale),
          },
          ...(input.nextTerm
            ? [
                {
                  label: copy.nextTerm,
                  value: formatPeriod(input.nextTerm, input.locale),
                },
              ]
            : []),
          ...(input.noticeServedOn
            ? [
                {
                  label: copy.noticeServed,
                  value: formatDate(input.noticeServedOn, input.locale),
                },
              ]
            : []),
          {
            label: copy.effectiveDate,
            value: formatDate(input.effectiveDate, input.locale),
          },
          { label: copy.renewalType, value: input.renewalType },
          { label: copy.recordedBy, value: input.recordedBy },
        ]}
      />
      <DocumentSection keepTogether title={copy.confirmation}>
        <View style={styles.cardMuted}>
          <Text style={styles.body}>{input.confirmationText}</Text>
        </View>
      </DocumentSection>
    </BrandedDocument>
  );
}

function DeletionCertificateDocument({
  input,
}: {
  input: DeletionCertificateDocumentInput;
}) {
  const title = documentTitles[input.kind];
  const exclusionColumns: readonly TableColumn[] = [
    { label: copy.deletionScope, width: "38%" },
    { label: copy.status, width: "37%" },
    { label: copy.effectiveDate, width: "25%" },
  ];
  const exclusionRows: readonly TableRowData[] = input.retentionExclusions.map(
    (exclusion) => ({
      cells: [
        { value: exclusion.scope },
        { value: exclusion.reason },
        {
          value: formatDate(exclusion.retentionExpiresOn, input.locale),
        },
      ],
      id: exclusion.id,
    }),
  );

  return (
    <BrandedDocument
      input={input}
      subject={`${title} ${input.certificateNumber}`}
      title={title}
    >
      <Parties
        issuer={input.issuer}
        issuerLabel={copy.shipTo}
        recipient={input.recipient}
        recipientLabel={copy.billTo}
      />
      <KeyValueGrid
        items={[
          { label: copy.documentId, value: input.certificateNumber },
          { label: copy.accountReference, value: input.accountReference },
          { label: copy.orderReference, value: input.orderReference ?? "-" },
          {
            label: copy.completedAt,
            value: formatDateTime(input.completedAt, input.locale),
          },
          { label: copy.deletionMethod, value: input.deletionMethod },
          {
            label: copy.confirmation,
            value: input.orchestratorConfirmation,
          },
        ]}
      />
      <DocumentSection title={copy.deletionScope}>
        <BulletList items={input.deletionScope} />
      </DocumentSection>
      <DocumentSection presenceAhead={160} title={copy.retentionExclusions}>
        {input.retentionExclusions.length > 0 ? (
          <>
            <Text style={styles.small}>{copy.retentionNotice}</Text>
            <DataTable columns={exclusionColumns} rows={exclusionRows} />
          </>
        ) : (
          <View style={styles.cardMuted}>
            <Text style={styles.body}>{copy.noRetentionExclusions}</Text>
          </View>
        )}
      </DocumentSection>
      <DocumentSection keepTogether title={copy.approvedBy}>
        <KeyValueGrid
          items={input.approvedBy.map((approval) => ({
            label: approval.role,
            value: `${approval.name} - ${formatDateTime(
              approval.approvedAt,
              input.locale,
            )}`,
          }))}
        />
      </DocumentSection>
    </BrandedDocument>
  );
}

function ReportDocument({ input }: { input: ReportDocumentInput }) {
  const title = input.reportTitle || documentTitles[input.kind];
  const fallbackWidth = 100 / Math.max(input.columns.length, 1);
  const columns: readonly TableColumn[] = input.columns.map((column) =>
    column.align
      ? {
          align: column.align,
          label: column.label,
          width: `${column.width ?? fallbackWidth}%`,
        }
      : {
          label: column.label,
          width: `${column.width ?? fallbackWidth}%`,
        },
  );
  const rows: readonly TableRowData[] = input.rows.map((row) => ({
    cells: input.columns.map((column) =>
      tableCell(
        row.values[column.key] ?? "-",
        row.emphasis && row.emphasis !== "normal"
          ? row.emphasis.toUpperCase()
          : undefined,
      ),
    ),
    id: row.id,
  }));
  const rowChunks: readonly (readonly TableRowData[])[] = Array.from(
    { length: Math.ceil(rows.length / 8) },
    (_, index) => rows.slice(index * 8, index * 8 + 8),
  );
  const pages = [
    <React.Fragment key="report-summary">
      <KeyValueGrid
        items={[
          {
            label: copy.period,
            value: formatPeriod(input.period, input.locale),
          },
          {
            label: copy.generatedAt,
            value: formatDateTime(input.generatedAt, input.locale),
          },
          { label: copy.basis, value: input.basis },
          ...(input.status
            ? [{ label: copy.status, value: input.status }]
            : []),
        ]}
      />
      <DocumentSection title={copy.summary}>
        <KeyValueGrid
          items={input.summary.map((item) => ({
            label: item.label,
            value: item.detail ? `${item.value} (${item.detail})` : item.value,
          }))}
        />
      </DocumentSection>
    </React.Fragment>,
    ...rowChunks.map((chunk, index) => (
      <DocumentSection key={`report-rows-${index + 1}`} title={title}>
        <DataTable columns={columns} rows={chunk} />
      </DocumentSection>
    )),
    <DocumentSection key="report-exceptions" title={copy.exceptions}>
      {input.exceptions && input.exceptions.length > 0 ? (
        <BulletList items={input.exceptions} />
      ) : (
        <Text style={styles.small}>{copy.noExceptions}</Text>
      )}
    </DocumentSection>,
  ];

  return (
    <BrandedDocument
      input={input}
      orientation="landscape"
      pages={pages}
      subject={`${documentTitles[input.kind]} ${input.documentId}`}
      title={title}
    />
  );
}

export function CommerceDocument({ input }: { input: CommerceDocumentInput }) {
  switch (input.kind) {
    case "direct_quote":
    case "partner_resale_quote":
    case "partner_transfer_quote":
      return <QuoteDocument input={input} />;
    case "order_form":
      return <OrderFormDocument input={input} />;
    case "amendment":
      return <AmendmentDocument input={input} />;
    case "poc_final_report":
    case "poc_summary":
      return <PocDocument input={input} />;
    case "invoice_companion":
    case "receipt":
      return <InvoiceDocument input={input} />;
    case "commission_statement":
      return <CommissionStatementDocument input={input} />;
    case "decline_confirmation":
    case "renewal_confirmation":
      return <RenewalConfirmationDocument input={input} />;
    case "deletion_certificate":
      return <DeletionCertificateDocument input={input} />;
    case "reconciliation_report":
    case "report_export":
      return <ReportDocument input={input} />;
  }
}
