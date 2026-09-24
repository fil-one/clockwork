import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import { demoText } from "@clockwork/testing/demo-localized-text";
import {
  FileDemoAdapterStateStore,
  findDemoProductionMarker,
  type DemoAdapterState,
  type DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { commercialRecords } from "@/src/features/customer-partner/commercial/model";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import { partnerSurfaces } from "@/src/features/customer-partner/partner/partner-data";
import { formatMoney } from "@/src/features/shared/format";
import { formattingLocales, type Locale, type MessageId } from "@/src/i18n";
import { getLocale, getTranslations } from "@/src/i18n/server";

import { resolveScopedAccount } from "./authorization";
import {
  demoMemberInvites,
  demoProcurementProfile,
} from "./demo-account-controls";
import { demoInvoicePayments } from "./demo-invoice-payment";
import {
  demoInvoiceFigures,
  demoRecordArtifacts,
  demoUuid,
} from "./demo-artifact-catalog";
import {
  demoMessage,
  onDate,
  resolveDemoContent,
  type DemoMessage,
  type DemoReader,
} from "./demo-message";
import {
  demoAdditionalRecords,
  demoCommercialDueDates,
  demoCreatedOrderRecord,
  demoPaidInvoiceTitles,
  demoRecordAccounts,
  demoTaxedBillingRecords,
  DEMO_DEFAULT_CUSTOMER_ACCOUNT,
  DEMO_DEFAULT_PARTNER_ACCOUNT,
  type DemoCreatedOrder,
} from "./demo-portal-records";
import type { DemoCreatedQuote, DemoQuoteState } from "./demo-quote-flow";
import { configuredDemoStateStore } from "./demo-state-store";
import { DatabaseExperienceRepository } from "./repository";
import {
  ExperienceProblem,
  type ExperienceAudience,
  type ProjectionActionInput,
  type ProjectionActionReceipt,
  type ProjectionChannel,
  type ProjectionListInput,
  type ProjectionOrder,
  type ProjectionPage,
  type ProjectionRecord,
} from "./model";

export interface ProjectionSource {
  list(input: ProjectionListInput): Promise<ProjectionPage>;
  find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord>;
  action(input: ProjectionActionInput): Promise<ProjectionActionReceipt>;
  receipt(input: {
    session: SessionClaims;
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    accountId: string | null;
    recordKey: string;
    actionRequestId: string;
    requestId: string;
  }): Promise<ProjectionActionReceipt>;
}

export class DatabaseProjectionSource implements ProjectionSource {
  public constructor(
    private readonly repository = new DatabaseExperienceRepository(),
  ) {}

  public list(input: ProjectionListInput) {
    return this.repository.listProjections(input);
  }

  public find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ) {
    return this.repository.findProjection(input);
  }

  public action(input: ProjectionActionInput) {
    return this.repository.queueProjectionAction(input);
  }

  public receipt(input: Parameters<ProjectionSource["receipt"]>[0]) {
    return this.repository.getProjectionAction(input);
  }
}

interface DemoRecord {
  id: string;
  key: string;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  /** Domain identity; projection identity remains `id`. */
  aggregateType?: string;
  aggregateId?: string;
  /**
   * The account the record belongs to, mirroring `audience_account_id`. Null
   * only for the internal audience, which the persisted query scopes with
   * `audience_account_id is null`.
   */
  accountId: string | null;
  version: number;
  updatedAt: string;
  /** Whether freshness follows the request clock or the source transition. */
  freshnessMode: "request" | "source";
  data: Readonly<Record<string, unknown>>;
}

function ownerOf(
  audience: ExperienceAudience,
  channel: string,
  key: string,
  fallback: string,
): string {
  return demoRecordAccounts[`${audience}:${channel}:${key}`] ?? fallback;
}

/**
 * The authoritative facts a commercial fixture row carries: an order's status,
 * and the due or expiry instant the dashboard orders obligations by. Facts the
 * fixture states itself win over the demo's.
 */
function customerAuthoritative(record: (typeof commercialRecords)[number]): {
  authoritative?: Readonly<Record<string, unknown>>;
} {
  const own = (record as { authoritative?: unknown }).authoritative;
  const facts = {
    ...(demoCommercialDueDates[`${record.kind}:${record.id}`] ?? {}),
    ...(own && typeof own === "object" && !Array.isArray(own) ? own : {}),
    ...(record.kind === "orders" ? { status: record.status } : {}),
  };
  return Object.keys(facts).length > 0 ? { authoritative: facts } : {};
}

function customerRecords(): DemoRecord[] {
  return commercialRecords.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    key: record.id,
    audience: "customer" as const,
    channel: record.kind,
    accountId: ownerOf(
      "customer",
      record.kind,
      record.id,
      DEMO_DEFAULT_CUSTOMER_ACCOUNT,
    ),
    // Commercial `record.version` is a display value (for example agreement
    // semantic version 3.2), not the projection's optimistic row version.
    version: 1,
    updatedAt: record.updatedAt,
    freshnessMode: "request",
    data: {
      ...record,
      ...customerAuthoritative(record),
      allowedActions:
        record.kind === "quotes" && record.status === "open"
          ? ["accept", "expire"]
          : record.kind === "agreements" && record.status === "review"
            ? ["execute_agreement"]
            : record.kind === "pocs" && record.status === "complete"
              ? ["convert_poc"]
              : record.kind === "orders" && record.status === "active"
                ? ["request_renewal", "request_teardown"]
                : record.kind === "services" && record.status === "active"
                  ? ["request_teardown"]
                  : [],
    },
  }));
}

function partnerRecords(): DemoRecord[] {
  const records: DemoRecord[] = [];
  let index = 1000;
  for (const [channel, surface] of Object.entries(partnerSurfaces)) {
    for (const record of surface.records) {
      index += 1;
      const issuedQuote = channel === "quotes" && record.status === "open";
      records.push({
        id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        key: record.id,
        audience: "partner",
        channel: channel as ProjectionChannel,
        ...(channel === "quotes" ? { aggregateType: "quote" } : {}),
        accountId: ownerOf(
          "partner",
          channel,
          record.id,
          DEMO_DEFAULT_PARTNER_ACCOUNT,
        ),
        version: 1,
        updatedAt: "2026-07-31T16:00:00.000Z",
        freshnessMode: "request",
        data: {
          ...record,
          ...(channel === "quotes"
            ? {
                authoritative: {
                  status: issuedQuote ? "issued" : record.status,
                },
              }
            : {}),
          allowedActions: issuedQuote ? ["prepare_artifact"] : [],
        },
      });
    }
  }
  return records;
}

function customerCollectionRecords(): DemoRecord[] {
  const records: DemoRecord[] = [];
  let index = 2000;
  for (const [channel, collection] of Object.entries(customerCollections)) {
    for (const record of collection.records) {
      index += 1;
      records.push({
        id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        key: record.id,
        audience: "customer",
        channel: channel as ProjectionChannel,
        accountId: ownerOf(
          "customer",
          channel,
          record.id,
          DEMO_DEFAULT_CUSTOMER_ACCOUNT,
        ),
        version: record.recordVersion ?? 1,
        updatedAt: record.updatedAt,
        freshnessMode: "request",
        data: { ...record, allowedActions: [] },
      });
    }
  }
  return records;
}

function additionalRecords(): DemoRecord[] {
  return demoAdditionalRecords.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(4001 + index).padStart(12, "0")}`,
    key: record.key,
    audience: record.audience,
    channel: record.channel,
    ...(record.aggregateType ? { aggregateType: record.aggregateType } : {}),
    ...(record.aggregateId ? { aggregateId: record.aggregateId } : {}),
    accountId: record.accountId,
    version: record.version,
    updatedAt: record.updatedAt,
    freshnessMode:
      record.audience === "internal" && record.channel === "queues"
        ? "source"
        : "request",
    data: record.data,
  }));
}

function internalRecords(): DemoRecord[] {
  const updatedAt = "2026-07-31T16:00:00.000Z";
  const records: ReadonlyArray<{
    channel: ProjectionChannel;
    key: string;
    data: Readonly<Record<string, unknown>>;
  }> = [
    {
      channel: "queues",
      key: "EXC-COL-008",
      data: {
        title: demoText({
          en: "Collections aging decision",
          es: "Decisión sobre la antigüedad de cobros",
          fr: "Décision de recouvrement selon l’ancienneté",
          de: "Entscheidung zum Forderungsalter",
          ja: "債権回収の経過日数に関する判断",
          pt: "Decisão sobre a antiguidade da cobrança",
          zh: "收款账龄处理决定",
          ar: "قرار بشأن أعمار الديون قيد التحصيل",
        }),
        statusLabel: demoMessage("experience.data.status.slaBreachedHighRisk"),
        owner: "Amina Cole",
        nextAction: demoMessage("experience.data.next.verifyRetentionHold"),
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "queues",
      key: "EXC-PRV-012",
      data: {
        title: demoText({
          en: "Provisioning recovery approval",
          es: "Aprobación de la recuperación del aprovisionamiento",
          fr: "Approbation de la reprise du provisionnement",
          de: "Genehmigung der Wiederherstellung der Bereitstellung",
          ja: "プロビジョニング復旧の承認",
          pt: "Aprovação da recuperação do provisionamento",
          zh: "开通恢复审批",
          ar: "الموافقة على استعادة التهيئة",
        }),
        statusLabel: demoMessage("experience.data.status.dueTodayHighRisk"),
        owner: "James Kurz",
        nextAction: demoMessage("experience.data.next.reviewProviderEvidence"),
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "queues",
      key: "EXC-RET-003",
      data: {
        title: demoText({
          en: "Retention-exclusion deletion approval",
          es: "Aprobación de eliminación con exclusiones por conservación",
          fr: "Approbation d’une suppression avec exclusions de conservation",
          de: "Genehmigung einer Löschung mit Aufbewahrungsausnahmen",
          ja: "保持対象を除外した削除の承認",
          pt: "Aprovação de exclusão com exceções de retenção",
          zh: "保留例外删除审批",
          ar: "الموافقة على الحذف مع استثناءات الاحتفاظ",
        }),
        statusLabel: demoMessage("experience.data.status.blockedLegalReview"),
        owner: "Juno Okafor",
        nextAction: demoMessage("experience.data.next.confirmLegalHold"),
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "approvals",
      key: "APR-DEMO-001",
      data: {
        title: demoText({
          en: "Pricing exception approval",
          es: "Aprobación de una excepción de precios",
          fr: "Approbation d’une exception tarifaire",
          de: "Genehmigung einer Preisausnahme",
          ja: "価格例外の承認",
          pt: "Aprovação de exceção de preço",
          zh: "价格例外审批",
          ar: "الموافقة على استثناء في التسعير",
        }),
        statusLabel: demoMessage("experience.data.status.awaitingApproval"),
        owner: demoText({
          en: "Finance review",
          es: "Revisión financiera",
          fr: "Revue financière",
          de: "Finanzprüfung",
          ja: "財務レビュー担当",
          pt: "Revisão financeira",
          zh: "财务审核团队",
          ar: "فريق المراجعة المالية",
        }),
        nextAction: demoMessage(
          "experience.data.next.compareExceptionEvidence",
        ),
        allowedActions: ["approve_exception", "reject_exception"],
      },
    },
    {
      channel: "provisioning",
      key: "PRV-DEMO-001",
      data: {
        title: demoText({
          en: "Madrid replica recovery",
          es: "Recuperación de la réplica de Madrid",
          fr: "Reprise de la réplique de Madrid",
          de: "Wiederherstellung des Madrid-Replikats",
          ja: "マドリードのレプリカの復旧",
          pt: "Recuperação da réplica de Madri",
          zh: "马德里副本恢复",
          ar: "استعادة النسخة المتماثلة في مدريد",
        }),
        statusLabel: demoMessage(
          "experience.data.status.providerRecoveryQueued",
        ),
        owner: demoText({
          en: "Platform operations",
          es: "Operaciones de plataforma",
          fr: "Opérations plateforme",
          de: "Plattformbetrieb",
          ja: "プラットフォーム運用チーム",
          pt: "Operações de plataforma",
          zh: "平台运营团队",
          ar: "فريق عمليات المنصة",
        }),
        nextAction: demoMessage("experience.data.next.reconcileProviderEvent"),
        allowedActions: ["replay_provider_event"],
      },
    },
  ];
  return records.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(3001 + index).padStart(12, "0")}`,
    key: record.key,
    audience: "internal" as const,
    channel: record.channel,
    accountId: null,
    version: 1,
    updatedAt,
    freshnessMode: record.channel === "queues" ? "source" : "request",
    data: record.data,
  }));
}

const demoRecords = [
  ...customerRecords(),
  ...customerCollectionRecords(),
  ...partnerRecords(),
  ...internalRecords(),
  ...additionalRecords(),
];

/**
 * The orders a prospect created during this session, on the orders channel.
 *
 * Read from the demo state on every read rather than folded into the seeded
 * `demoRecords` constant, because they are written after that constant is
 * built. The projection identifier is derived from the order identifier so it
 * is stable across reads -- an identifier that changed between the collection
 * read and the detail read would make the record unopenable.
 *
 * This is the last link in the acceptance chain. Without it the create pass
 * would succeed, the surface would offer "Track this acceptance in orders", and
 * the ledger behind that link would not hold the order -- which is the same
 * dead end this whole change exists to close, moved one step later.
 */
function createdOrderRecords(
  state: DemoAdapterState,
  formatting: string,
): DemoRecord[] {
  const created = (
    state as { createdOrders?: Record<string, DemoCreatedOrder> }
  ).createdOrders;
  if (!created) return [];
  return Object.values(created).map((order) => {
    const record = demoCreatedOrderRecord(order, formatting);
    return {
      id: demoUuid(`projection:order:${order.id}`),
      key: record.key,
      audience: record.audience,
      channel: record.channel,
      aggregateType: "order",
      aggregateId: order.id,
      accountId: record.accountId,
      version: record.version,
      updatedAt: record.updatedAt,
      freshnessMode: "request",
      data: record.data,
    };
  });
}

/** A created quote's chip, by the authoritative quote status. */
const createdQuoteStatusLabels: Readonly<
  Record<DemoCreatedQuote["snapshot"]["status"], DemoMessage>
> = {
  draft: demoMessage("status.quote.draft"),
  issued: demoMessage("experience.data.status.quoteIssuedReady"),
  accepted: demoMessage("status.quote.accepted"),
  expired: demoMessage("status.quote.expired"),
  superseded: demoMessage("experience.data.status.quoteSupersededByRevision"),
  rejected: demoMessage("status.quote.rejected"),
};

/** Quotes created by the direct-buy command, projected into the customer ledger. */
function createdQuoteRecords(
  state: DemoAdapterState,
  formatting: string,
): DemoRecord[] {
  const created = (
    state as { createdQuotes?: Readonly<Record<string, DemoCreatedQuote>> }
  ).createdQuotes;
  if (!created) return [];
  return Object.values(created).map((quote) => {
    const snapshot = quote.snapshot;
    const issued = snapshot.status === "issued";
    const presentationStatus = issued ? "open" : snapshot.status;
    const quoteState = state as DemoQuoteState & {
      acceptedQuoteOrders?: Readonly<Record<string, string>>;
    };
    const artifacts = Object.values(quoteState.commercialArtifactRequests ?? {})
      .filter(
        (request) =>
          request.subjectType === "quote" &&
          request.subjectId === snapshot.id &&
          request.commercialAccountId === snapshot.accountId &&
          request.documentId === snapshot.renderedDocumentId &&
          quoteState.artifactDeliveries?.[request.id]?.documentId ===
            request.documentId,
      )
      .map((request) => ({
        kind: "direct_quote" as const,
        id: request.id,
        label: demoMessage("experience.data.artifact.quoteDocument"),
        state: "stored" as const,
      }));
    return {
      id: demoUuid(`projection:quote:${snapshot.id}`),
      key: `quote-${snapshot.id}`,
      audience: "customer",
      channel: "quotes",
      aggregateType: "quote",
      aggregateId: snapshot.id,
      accountId: snapshot.accountId,
      version: quote.rowVersion,
      updatedAt: quote.updatedAt,
      // This view is rebuilt from the authoritative demo store on every read.
      // An unchanged quote is not a lagging projection.
      freshnessMode: "request",
      data: {
        kind: "quotes",
        artifacts,
        ...(quoteState.acceptedQuoteOrders?.[snapshot.id]
          ? {
              nextActionHref: `/orders/order-${quoteState.acceptedQuoteOrders[snapshot.id]}`,
            }
          : {}),
        id: `quote-${snapshot.id}`,
        title: demoMessage("experience.data.title.createdQuote", {
          reference: quote.displayNumber,
        }),
        description: demoMessage("experience.data.desc.createdQuoteLines", {
          count: snapshot.lines.length,
        }),
        reference: quote.displayNumber,
        status: presentationStatus,
        statusLabel: createdQuoteStatusLabels[snapshot.status],
        tone: issued ? "warning" : "neutral",
        risk:
          snapshot.marginResult === "exception_required" ||
          snapshot.marginResult === "rejected"
            ? "high"
            : "low",
        owner: demoMessage("experience.data.owner.buyerWorkspace"),
        value: formatMoney(
          snapshot.total.minor,
          snapshot.total.currency,
          formatting,
        ),
        valueLabel: demoMessage("experience.data.label.quotedTotal"),
        dateLabel: demoMessage("common.expiresOn", {
          date: onDate(snapshot.expiresAt.slice(0, 10)),
        }),
        term: demoMessage("experience.data.term.paymentTermsAgreementVersion", {
          count: quote.paymentTermsDays,
          version: String(quote.agreementVersion),
        }),
        nextAction: issued
          ? demoMessage("experience.data.next.reviewAcceptIssuedQuote")
          : snapshot.status === "draft"
            ? demoMessage("experience.data.next.prepareIssueQuoteDocument")
            : snapshot.status === "superseded"
              ? demoMessage("experience.data.next.continueRevisedQuote")
              : demoMessage("experience.data.next.viewQuoteHistory"),
        allowedActions: issued ? ["accept", "expire"] : [],
        totalMinor: snapshot.total.minor,
        currency: snapshot.total.currency,
        marginResult: snapshot.marginResult,
        buyerDomain: quote.buyerDomain,
        agreementId: quote.agreementId,
        agreementVersion: quote.agreementVersion,
        agreementEffectiveOn: quote.agreementEffectiveOn,
        paymentTermsDays: quote.paymentTermsDays,
        authoritative: {
          status: snapshot.status,
          marginFloorResult: snapshot.marginResult,
          revision: snapshot.revision,
          accountId: snapshot.accountId,
          seriesId: snapshot.seriesId,
          lines: snapshot.lines.map(
            ({ sku, region, quantity, termMonths }) => ({
              sku,
              region,
              quantity,
              termMonths,
            }),
          ),
          priceBookId: snapshot.priceBook.id,
          priceBookVersion: snapshot.priceBook.version,
        },
      },
    };
  });
}

const inviteRoleLabels = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
} as const satisfies Record<
  ReturnType<typeof demoMemberInvites>[number]["role"],
  MessageId
>;

function accountControlRecords(state: DemoAdapterState): DemoRecord[] {
  const accounts = new Set(
    demoRecords
      .filter((record) => record.audience === "customer" && record.accountId)
      .map((record) => record.accountId as string),
  );
  return [...accounts].flatMap((accountId) => {
    const invites = demoMemberInvites(state, accountId).map(
      (invite): DemoRecord => ({
        id: demoUuid(`member-invite-projection:${invite.id}`),
        key: `invite-${invite.id}`,
        audience: "customer",
        channel: "users",
        aggregateType: "organization_invite",
        aggregateId: invite.id,
        accountId,
        version: 1,
        updatedAt: invite.createdAt,
        freshnessMode: "source",
        data: {
          id: `invite-${invite.id}`,
          title: invite.email,
          description: demoMessage("experience.data.desc.pendingInvitation", {
            role: demoMessage(inviteRoleLabels[invite.role]),
          }),
          status: "pending",
          statusLabel: demoMessage("experience.data.status.invitationPending"),
          risk: "low",
          owner: invite.email,
          value: demoMessage(inviteRoleLabels[invite.role]),
          valueSort: 1,
          updatedLabel: demoMessage("experience.data.date.invitedRecently"),
          context: [
            {
              label: demoMessage("experience.data.label.expires"),
              value: onDate(invite.expiresAt),
            },
            {
              label: demoMessage("experience.data.label.organization"),
              value: invite.organizationId,
            },
          ],
          allowedActions: [],
        },
      }),
    );
    const profile = demoProcurementProfile(state, accountId);
    return [
      ...invites,
      ...(profile
        ? [
            {
              id: demoUuid(`procurement-profile-projection:${accountId}`),
              key: "PROC-AP",
              audience: "customer" as const,
              channel: "procurement" as const,
              aggregateType: "procurement_profile",
              aggregateId: accountId,
              accountId,
              version: profile.rowVersion,
              updatedAt: profile.updatedAt,
              freshnessMode: "source" as const,
              data: {
                id: "PROC-AP",
                title: demoMessage(
                  "experience.data.title.accountsPayableRouting",
                ),
                description: demoMessage(
                  "experience.data.desc.procurementRoutes",
                ),
                status: "active",
                statusLabel: demoMessage("experience.data.status.verified"),
                risk: "low",
                owner: profile.apContact.name,
                value: profile.invoiceDeliveryEmail,
                valueSort: profile.poRequired ? 2 : 1,
                updatedLabel: demoMessage(
                  "experience.data.date.updatedRecently",
                ),
                context: [
                  {
                    label: demoMessage("experience.data.label.apContact"),
                    value: profile.apContact.email,
                  },
                  {
                    label: demoMessage("experience.data.label.purchaseOrder"),
                    value: profile.poRequired
                      ? demoMessage("experience.data.value.poRequired")
                      : demoMessage("experience.data.value.poNotRequired"),
                  },
                ],
                allowedActions: [],
              },
            },
          ]
        : []),
    ];
  });
}

function demoRecordsForState(
  state: DemoAdapterState,
  formatting: string,
): DemoRecord[] {
  const controls = accountControlRecords(state);
  const replaced = new Set(
    controls.map(
      (record) =>
        `${record.audience}:${record.channel}:${record.accountId}:${record.key}`,
    ),
  );
  return [
    ...demoRecords.filter(
      (record) =>
        !replaced.has(
          `${record.audience}:${record.channel}:${record.accountId}:${record.key}`,
        ),
    ),
    ...controls,
    ...createdOrderRecords(state, formatting),
    ...createdQuoteRecords(state, formatting),
  ];
}

function applyInvoicePayment(
  record: DemoRecord,
  state: DemoAdapterState,
): DemoRecord {
  const payment = demoInvoicePayments(state).find(
    (candidate) =>
      candidate.status === "paid" &&
      candidate.recordKey === record.key &&
      candidate.accountId === record.accountId,
  );
  if (!payment?.receiptId || !payment.completedAt) return record;
  const authoritative =
    record.data.authoritative &&
    typeof record.data.authoritative === "object" &&
    !Array.isArray(record.data.authoritative)
      ? (record.data.authoritative as Readonly<Record<string, unknown>>)
      : {};
  return {
    ...record,
    version: record.version + 1,
    updatedAt: payment.completedAt,
    freshnessMode: "source",
    data: {
      ...record.data,
      title:
        typeof record.data.title === "string"
          ? record.data.title.replace(/ · overdue$/u, " · paid")
          : (demoPaidInvoiceTitles[record.key] ?? record.data.title),
      status: "paid",
      statusLabel: demoMessage("experience.data.status.invoicePaidSandbox"),
      tone: "success",
      risk: "low",
      description: demoMessage("experience.data.desc.demoReceipt", {
        receipt: payment.receiptId,
      }),
      dateLabel: demoMessage("experience.data.date.demoPaymentConfirmed", {
        date: onDate(payment.completedAt.slice(0, 10)),
      }),
      nextAction: demoMessage("experience.data.next.paymentComplete"),
      allowedActions: [],
      authoritative: {
        ...authoritative,
        status: "paid",
        provider: "demo_sandbox",
        paymentAttemptId: payment.paymentAttemptId,
        receiptId: payment.receiptId,
        completedAt: payment.completedAt,
      },
    },
  };
}

/**
 * The projection identifier a seeded demo record is served under.
 *
 * The identifiers are positional, assigned by the builders above, and the
 * acceptance surface sends one back as `quoteId` — it is the `aggregateId` the
 * quote row was rendered with. Resolving it here rather than restating the
 * numbering elsewhere is what keeps the two from drifting apart when a fixture
 * is inserted into the middle of one of those arrays.
 */
export function demoProjectionRecordId(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  recordKey: string,
): string | undefined {
  return demoRecords.find(
    (record) =>
      record.audience === audience &&
      record.channel === channel &&
      record.key === recordKey,
  )?.id;
}

/** The seeded version used before a durable demo override exists. */
export function demoProjectionRecordVersion(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  recordKey: string,
): number | undefined {
  return demoRecords.find(
    (record) =>
      record.audience === audience &&
      record.channel === channel &&
      record.key === recordKey,
  )?.version;
}

function applyDemoState(
  record: DemoRecord,
  state: DemoAdapterState,
): DemoRecord {
  const override =
    state.projectionOverrides[record.id] ??
    (record.aggregateType === "quote" && record.aggregateId
      ? state.projectionOverrides[record.aggregateId]
      : undefined);
  if (!override) return record;
  return {
    ...record,
    version: override.version,
    updatedAt: override.updatedAt,
    data: {
      ...record.data,
      ...override.data,
      ...(record.aggregateType === "quote" &&
      override.data.status === "accepted"
        ? {
            authoritative: {
              ...(record.data.authoritative as Record<string, unknown>),
              status: "accepted",
            },
          }
        : {}),
    },
  };
}

/**
 * The account test the persisted read applies.
 *
 * `accountScope` in the repository is `audience_account_id = $1` — or
 * `audience_account_id is null` when the caller resolved to no account, which
 * is the internal audience — and the `experience_projection_read` row policy
 * repeats it. This is the same predicate. Before it existed, a customer persona
 * could open another account's quote and the demo would render it under their
 * own account identifier: not a dead end, but the demo showing something the
 * product refuses.
 */
function withinAccount(record: DemoRecord, accountId: string | null): boolean {
  return record.accountId === accountId;
}

/**
 * The determination the money-bearing demo rows read their figures from.
 *
 * An "invoiced amount" is gross of tax. The fixtures state the net, and the
 * gross is whatever the engine says it is under the seeded rule book — so the
 * collection, the detail page and the invoice PDF cannot disagree, because
 * there is only one place the number comes from.
 */
async function taxedBillingData(
  record: DemoRecord,
  formatting: string,
): Promise<Readonly<Record<string, unknown>>> {
  const figures = await demoInvoiceFigures();
  const gross = formatMoney(figures.grossMinor, figures.currency, formatting);
  const tax = formatMoney(figures.taxMinor, figures.currency, formatting);
  const net = formatMoney(figures.netMinor, figures.currency, formatting);
  const existingAuthoritative =
    record.data.authoritative &&
    typeof record.data.authoritative === "object" &&
    !Array.isArray(record.data.authoritative)
      ? (record.data.authoritative as Readonly<Record<string, unknown>>)
      : {};
  return {
    ...record.data,
    value: gross,
    valueLabel: demoMessage("experience.data.label.invoicedInclTax"),
    invoicedNetOfTax: net,
    taxDetermined: tax,
    taxTreatment: figures.summary,
    authoritative: {
      ...existingAuthoritative,
      amountMinor: figures.grossMinor,
      currency: figures.currency,
    },
  };
}

async function projectionData(
  record: DemoRecord,
  formatting: string,
): Promise<Readonly<Record<string, unknown>>> {
  const data = demoTaxedBillingRecords.includes(
    `${record.audience}:${record.channel}:${record.key}`,
  )
    ? await taxedBillingData(record, formatting)
    : record.data;
  const artifacts = demoRecordArtifacts(
    record.audience,
    record.channel,
    record.key,
  );
  return artifacts.length > 0 ? { ...data, artifacts } : data;
}

function asProjection(
  record: DemoRecord,
  data: Readonly<Record<string, unknown>>,
  now: Date,
): ProjectionRecord {
  const sourceUpdatedAt =
    record.freshnessMode === "request" ? now.toISOString() : record.updatedAt;
  return {
    id: record.id,
    recordKey: record.key,
    aggregateType: record.aggregateType ?? record.channel,
    aggregateId: record.aggregateId ?? record.id,
    // The record's own account, not the caller's. The two are equal after the
    // scope filter; stamping the caller's was how another account's record used
    // to arrive labelled as the reader's own.
    accountId: record.accountId,
    audience: record.audience,
    channel: record.channel,
    version: record.version,
    sourceUpdatedAt,
    projectedAt: now.toISOString(),
    stale: now.getTime() - Date.parse(sourceUpdatedAt) > 300_000,
    data,
  };
}

function actionRequestDigest(input: ProjectionActionInput): string {
  return createHash("sha256")
    .update(input.projectionId)
    .update("\0")
    .update(input.action)
    .update("\0")
    .update(String(input.expectedVersion))
    .update("\0")
    .update(JSON.stringify(input.payload))
    .digest("hex");
}

function actionReceiptId(input: ProjectionActionInput): string {
  return demoUuid(
    `projection-action:${input.session.userId}:${input.idempotencyKey}`,
  );
}

function appliedActionData(
  current: Readonly<Record<string, unknown>>,
  action: string,
): Readonly<Record<string, unknown>> {
  const authoritative =
    current.authoritative &&
    typeof current.authoritative === "object" &&
    !Array.isArray(current.authoritative)
      ? (current.authoritative as Readonly<Record<string, unknown>>)
      : {};
  // Labels are persisted as message references, never as prose: this data is
  // written to the demo state store and read back by every later reader, in
  // their own language.
  const transition: Readonly<
    Record<
      string,
      {
        readonly status: string;
        readonly statusLabel: DemoMessage;
        readonly nextAction: DemoMessage;
        readonly authoritativeStatus?: string;
      }
    >
  > = {
    accept: {
      status: "accepted",
      statusLabel: demoMessage("status.quote.accepted"),
      nextAction: demoMessage("experience.data.next.continueOrderAcceptance"),
      authoritativeStatus: "accepted",
    },
    expire: {
      status: "expired",
      statusLabel: demoMessage("status.quote.expired"),
      nextAction: demoMessage("experience.data.next.createRevisedQuote"),
      authoritativeStatus: "expired",
    },
    prepare_artifact: {
      status: "ready",
      statusLabel: demoMessage("experience.data.status.documentPrepared"),
      nextAction: demoMessage("experience.data.next.reviewPreparedDocument"),
    },
    review_exception: {
      status: "complete",
      statusLabel: demoMessage("experience.data.status.reviewRecorded"),
      nextAction: demoMessage("experience.data.next.noFurtherReview"),
    },
    approve_exception: {
      status: "approved",
      statusLabel: demoMessage("status.approved"),
      nextAction: demoMessage(
        "experience.data.next.continueAuthorizedWorkflow",
      ),
      authoritativeStatus: "approved",
    },
    reject_exception: {
      status: "rejected",
      statusLabel: demoMessage("status.rejected"),
      nextAction: demoMessage("experience.data.next.returnRequestToOwner"),
      authoritativeStatus: "rejected",
    },
    evaluate_dunning: {
      status: "open",
      statusLabel: demoMessage("experience.data.status.dunningEvaluated"),
      nextAction: demoMessage("experience.data.next.reviewCollectionsCase"),
    },
    replay_provider_event: {
      status: "recovering",
      statusLabel: demoMessage("experience.data.status.providerReplayRecorded"),
      nextAction: demoMessage("experience.data.next.monitorProvisioning"),
      authoritativeStatus: "recovering",
    },
    execute_agreement: {
      status: "active",
      statusLabel: demoMessage("experience.data.status.agreementExecuted"),
      nextAction: demoMessage("experience.data.next.useVersionForCommitments"),
      authoritativeStatus: "active",
    },
    convert_poc: {
      status: "converted",
      statusLabel: demoMessage("experience.data.status.pocConverted"),
      nextAction: demoMessage(
        "experience.data.next.reviewIssuedConversionQuote",
      ),
      authoritativeStatus: "converted",
    },
    request_renewal: {
      status: "renewal_requested",
      statusLabel: demoMessage("status.renewalRequested"),
      nextAction: demoMessage(
        "experience.data.next.reviewRenewalQuoteWhenIssued",
      ),
      authoritativeStatus: "renewal_requested",
    },
    request_teardown: {
      status: "offboarding_requested",
      statusLabel: demoMessage("status.offboardingRequested"),
      nextAction: demoMessage(
        "experience.data.next.awaitTwoPersonRetentionReview",
      ),
      authoritativeStatus: "offboarding_requested",
    },
  };
  const selected = transition[action] ?? {
    status: "complete",
    statusLabel: demoMessage("experience.data.status.actionComplete"),
    nextAction: demoMessage("experience.data.next.noFurtherAction"),
  };
  return {
    status: selected.status,
    statusLabel: selected.statusLabel,
    nextAction: selected.nextAction,
    allowedActions: [],
    ...(selected.authoritativeStatus
      ? {
          authoritative: {
            ...authoritative,
            status: selected.authoritativeStatus,
          },
        }
      : {}),
  };
}

/**
 * Who the demo boundary renders for.
 *
 * `requested` is the interface language the caller read from the request's
 * language cookie (`portal-view-loader` through `getLocale()`, the API
 * controller from the same cookie header). The translator comes from the same
 * request, so demo text, messages and formatting all agree. A caller that
 * names no language gets the request's language, never English by default:
 * the artifact read in `delivery.ts` and the action re-read below both omit
 * it, and a default of "en" rendered their labels in English for everyone.
 */
async function demoReader(requested: Locale | undefined): Promise<DemoReader> {
  const [locale, t] = await Promise.all([
    requested ?? getLocale(),
    getTranslations(),
  ]);
  return { locale, formatting: formattingLocales[locale], t };
}

/**
 * The demo read boundary: where a fixture becomes what one reader sees.
 *
 * Product-authored text (`demoMessage`), demo-authored text (`demoText`) and
 * the facts both carry (amounts, dates, durations) are rendered in the
 * reader's language and formatting here and nowhere earlier. Anything written
 * back to the demo state store is taken from the record before this step (see
 * `action`) and is itself a message reference, so a stored override keeps
 * facts and every language rather than one reader's rendering.
 * `DatabaseProjectionSource` never reaches this function.
 */
async function projectRecord(
  record: DemoRecord,
  now: Date,
  reader: DemoReader,
): Promise<ProjectionRecord> {
  const data = await projectionData(record, reader.formatting);
  return asProjection(record, resolveDemoContent(data, reader), now);
}

/** Deterministic fixtures selected only through CLOCKWORK_EXPERIENCE_ADAPTER=demo. */
export class ExplicitDemoProjectionSource implements ProjectionSource {
  public constructor(
    private readonly stateStore: DemoAdapterStateStore = new FileDemoAdapterStateStore(),
  ) {}

  public async list(input: ProjectionListInput): Promise<ProjectionPage> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ExperienceProblem(
        422,
        "INVALID_CURSOR",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Projection cursor is invalid",
      );
    const state = await this.stateStore.read();
    const reader = await demoReader(input.locale);
    const selected = demoRecordsForState(state, reader.formatting)
      .filter(
        (record) =>
          record.audience === input.audience &&
          record.channel === input.channel &&
          withinAccount(record, input.accountId),
      )
      .map((record) =>
        applyInvoicePayment(applyDemoState(record, state), state),
      );
    // Only an explicit `orderBy` sorts. The fixtures' own declaration order is
    // what the demo tour and its screenshots were built against, and quietly
    // re-sorting every unordered read to match the database's keyset would
    // change what the demo shows without any caller asking for it.
    const matching = input.orderBy
      ? [...selected].sort((left, right) => {
          const byKeyset =
            Date.parse(left.updatedAt) - Date.parse(right.updatedAt) ||
            left.id.localeCompare(right.id);
          return input.orderBy === "updated_asc" ? byKeyset : -byKeyset;
        })
      : selected;
    const page = matching.slice(offset, offset + input.limit);
    return {
      items: await Promise.all(
        page.map((record) => projectRecord(record, input.now, reader)),
      ),
      nextCursor:
        offset + page.length < matching.length
          ? String(offset + page.length)
          : null,
      generatedAt: input.now.toISOString(),
      freshnessSeconds: 300,
    };
  }

  public find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord> {
    return this.findWithState(input);
  }

  private async findWithState(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord> {
    // The account test is part of the match, not a check after it, so a record
    // outside the caller's account is indistinguishable from one that does not
    // exist. The persisted read collapses the two the same way, deliberately:
    // telling them apart would be an enumeration oracle for another tenant's
    // references.
    const state = await this.stateStore.read();
    const reader = await demoReader(input.locale);
    const record = demoRecordsForState(state, reader.formatting).find(
      (item) =>
        item.audience === input.audience &&
        item.channel === input.channel &&
        item.key === input.recordKey &&
        withinAccount(item, input.accountId),
    );
    if (!record)
      throw new ExperienceProblem(
        404,
        "PROJECTION_NOT_FOUND",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Projection record not found",
      );
    return projectRecord(
      applyInvoicePayment(applyDemoState(record, state), state),
      input.now,
      reader,
    );
  }

  public async action(
    input: ProjectionActionInput,
  ): Promise<ProjectionActionReceipt> {
    const receiptId = actionReceiptId(input);
    const requestDigest = actionRequestDigest(input);
    const resultReference = `demo-action:${requestDigest}`;
    const replay = (
      existing: ProjectionActionReceipt,
    ): ProjectionActionReceipt => {
      if (
        existing.projectionId !== input.projectionId ||
        existing.action !== input.action ||
        existing.expectedVersion !== input.expectedVersion ||
        existing.resultReference !== resultReference
      )
        throw new ExperienceProblem(
          409,
          "IDEMPOTENCY_CONFLICT",
          // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
          "The idempotency key is already bound to another projection action",
        );
      return { ...existing, commandReplayed: true };
    };
    const existing = (await this.stateStore.read()).actionReceipts[receiptId];
    if (existing) return replay(existing);

    const record = await this.find({
      session: input.session,
      audience: input.audience,
      channel: input.channel,
      accountId: input.accountId,
      recordKey: input.recordKey,
      now: new Date(),
    });
    if (record.id !== input.projectionId)
      throw new ExperienceProblem(
        404,
        "PROJECTION_NOT_FOUND",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Projection record not found",
      );
    if (record.version !== input.expectedVersion)
      throw new ExperienceProblem(
        409,
        "VERSION_CONFLICT",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Projection record changed",
      );
    const allowed = Array.isArray(record.data.allowedActions)
      ? record.data.allowedActions
      : [];
    if (!allowed.includes(input.action))
      throw new ExperienceProblem(
        403,
        "ACTION_FORBIDDEN",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Action is not allowed for this record",
      );
    const completedAt = new Date().toISOString();
    const receipt: ProjectionActionReceipt = {
      id: receiptId,
      projectionId: record.id,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      status: "applied",
      resultReference,
      resultCode: null,
      authoritativeVersion: record.version + 1,
      commandReplayed: false,
      createdAt: completedAt,
      completedAt,
      auditEventId: uuidV7(),
      outboxMessageId: uuidV7(),
    };
    let returned = receipt;
    await this.stateStore.update((state) => {
      const concurrent = state.actionReceipts[receiptId];
      if (concurrent) {
        returned = replay(concurrent);
        return state;
      }
      const currentOverride = state.projectionOverrides[record.id];
      const currentVersion = currentOverride?.version ?? record.version;
      if (currentVersion !== input.expectedVersion)
        throw new ExperienceProblem(
          409,
          "VERSION_CONFLICT",
          // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
          "Projection record changed",
        );
      const authoritativeVersion = currentVersion + 1;
      const appliedReceipt = {
        ...receipt,
        authoritativeVersion,
      };
      returned = appliedReceipt;
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [record.id]: {
            version: authoritativeVersion,
            updatedAt: completedAt,
            // Only what the action changed, on top of any earlier override.
            // `record` is what this reader was shown (their language, their
            // number formatting); persisting all of it would show the next
            // reader someone else's rendering.
            data: {
              ...(currentOverride?.data ?? {}),
              ...appliedActionData(
                { ...record.data, ...(currentOverride?.data ?? {}) },
                input.action,
              ),
            },
          },
        },
        actionReceipts: {
          ...state.actionReceipts,
          [receiptId]: appliedReceipt,
        },
      };
    });
    return returned;
  }

  public async receipt(
    input: Parameters<ProjectionSource["receipt"]>[0],
  ): Promise<ProjectionActionReceipt> {
    const projection = await this.find({
      session: input.session,
      audience: input.audience,
      channel: input.channel,
      accountId: input.accountId,
      recordKey: input.recordKey,
      now: new Date(),
    });
    const state = await this.stateStore.read();
    const receipt = state.actionReceipts[input.actionRequestId];
    if (!receipt || receipt.projectionId !== projection.id)
      throw new ExperienceProblem(
        404,
        "PROJECTION_ACTION_NOT_FOUND",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        "Projection action receipt not found",
      );
    return receipt;
  }
}

export interface DemoQueueRefreshResult {
  readonly refreshedAt: string;
  readonly refreshedRecords: number;
  readonly replayed: boolean;
}

/**
 * Advances the freshness of every seeded internal queue projection atomically.
 *
 * The caller owns request authentication and the exact request-byte digest.
 * This store boundary owns durable replay and never persists the raw
 * idempotency key. A reset clears both queue overrides and the receipt because
 * both live in the existing demo projection override collection.
 */
export async function refreshDemoQueueProjections(input: {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly now?: Date;
  readonly stateStore?: DemoAdapterStateStore;
}): Promise<DemoQueueRefreshResult> {
  const actorId = input.actorId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorId ||
    !idempotencyKey ||
    !/^[0-9a-f]{64}$/u.test(input.requestDigest)
  )
    throw new ExperienceProblem(
      422,
      "INVALID_DEMO_QUEUE_REFRESH",
      // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
      "Queue refresh identity, idempotency, and request digest are required",
    );
  const store = input.stateStore ?? configuredDemoStateStore();
  const receiptKey = `demo-queue-refresh-receipt:${createHash("sha256")
    .update(actorId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
  const refreshedAt = (input.now ?? new Date()).toISOString();
  if (!Number.isFinite(Date.parse(refreshedAt)))
    throw new ExperienceProblem(
      422,
      "INVALID_DEMO_QUEUE_REFRESH",
      // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
      "Queue refresh time is invalid",
    );
  const queueRecords = demoRecords.filter(
    (record) => record.audience === "internal" && record.channel === "queues",
  );
  if (queueRecords.length === 0)
    // i18n-exempt: an invariant failure for developers, never shown to a reader
    throw new Error("The demo queue fixture contains no refreshable records");

  let result: DemoQueueRefreshResult = {
    refreshedAt,
    refreshedRecords: queueRecords.length,
    replayed: false,
  };
  await store.update((state) => {
    const previousReceipt = state.projectionOverrides[receiptKey];
    if (previousReceipt) {
      const data = previousReceipt.data;
      if (
        data.kind !== "queue_refresh_receipt" ||
        data.actorId !== actorId ||
        data.requestDigest !== input.requestDigest ||
        typeof data.refreshedAt !== "string" ||
        !Number.isInteger(data.refreshedRecords) ||
        Number(data.refreshedRecords) <= 0
      )
        throw new ExperienceProblem(
          409,
          "IDEMPOTENCY_CONFLICT",
          // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
          "The idempotency key is already bound to another queue refresh",
        );
      result = {
        refreshedAt: data.refreshedAt,
        refreshedRecords: Number(data.refreshedRecords),
        replayed: true,
      };
      return state;
    }

    const overrides = { ...state.projectionOverrides };
    for (const record of queueRecords) {
      const current = overrides[record.id];
      overrides[record.id] = {
        version: (current?.version ?? record.version) + 1,
        updatedAt: refreshedAt,
        data: current?.data ?? {},
      };
    }
    overrides[receiptKey] = {
      version: 1,
      updatedAt: refreshedAt,
      data: {
        kind: "queue_refresh_receipt",
        actorId,
        requestDigest: input.requestDigest,
        refreshedAt,
        refreshedRecords: queueRecords.length,
      },
    };
    return {
      ...state,
      revision: state.revision + 1,
      projectionOverrides: overrides,
    };
  });
  return result;
}

export function configuredProjectionSource(): ProjectionSource {
  const adapter = process.env.CLOCKWORK_EXPERIENCE_ADAPTER?.trim();
  if (adapter === "demo") {
    const productionMarker = findDemoProductionMarker(process.env);
    if (productionMarker)
      throw new ExperienceProblem(
        503,
        "DEMO_ADAPTER_FORBIDDEN",
        // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
        `Demo portal data is disabled because ${productionMarker} identifies production`,
      );
    return demoProjectionSource;
  }
  if (adapter && adapter !== "database")
    throw new ExperienceProblem(
      503,
      "PROJECTION_ADAPTER_INVALID",
      // i18n-exempt: problem-details message in the API contract; integrators read it and the interface shows its own state
      "Projection adapter selection is invalid",
    );
  return new DatabaseProjectionSource();
}

export function projectionInput(input: {
  session: SessionClaims;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  requestedAccountId: string | null;
  cursor?: string;
  limit: number;
  orderBy?: ProjectionOrder;
  now?: Date;
  locale?: Locale;
}): ProjectionListInput {
  const accountId = resolveScopedAccount(
    input.session,
    input.audience,
    input.requestedAccountId,
  );
  return {
    session: input.session,
    audience: input.audience,
    channel: input.channel,
    accountId,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: input.limit,
    ...(input.orderBy ? { orderBy: input.orderBy } : {}),
    now: input.now ?? new Date(),
    ...(input.locale ? { locale: input.locale } : {}),
  };
}

const demoProjectionSource = new ExplicitDemoProjectionSource(
  configuredDemoStateStore(),
);
