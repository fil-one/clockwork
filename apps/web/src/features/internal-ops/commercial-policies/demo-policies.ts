import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyChannelPolicyCommand,
  applyPaygOfferCommand,
  channelPolicySnapshot,
  ChannelPolicyCommandSchema,
  ChannelPolicyRecordSchema,
  PaygOfferCommandSchema,
  PaygOfferRecordSchema,
  type ChannelPolicyCommand,
  type ChannelPolicyRecord,
  type PaygOfferCommand,
  type PaygOfferRecord,
} from "@clockwork/domain/core";
import {
  demoText,
  demoTextIn,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

const author = "21000000-0000-4000-8000-000000000010";

/*
 * Demo-authored text (translation policy rule 4). A finance user would type
 * these in production; in the demo they stand in for that, so a reader of the
 * Portuguese demo sees them in Portuguese. The stored and returned records
 * keep the English value (the domain schemas and other lanes' readers expect
 * plain strings); `localizeDemoPaygPolicy` and `localizeDemoChannelPolicy`
 * swap in the reader's language at the read boundary, and only while a field
 * still holds the fixture's English text, so a user's own edit is never
 * rewritten.
 */
const fixtureText = {
  reviewScenarioName: demoText({
    en: "Fictional PAYG review scenario",
    es: "Escenario ficticio de revisión de pago por uso",
    fr: "Scénario fictif d’examen du paiement à l’usage",
    de: "Fiktives Prüfszenario für nutzungsbasierte Abrechnung",
    ja: "従量課金レビュー用の架空シナリオ",
    pt: "Cenário fictício de revisão de pagamento por uso",
    zh: "虚构的按量付费审核场景",
    ar: "سيناريو افتراضي لمراجعة الدفع حسب الاستخدام",
  }),
  noTermStorageName: demoText({
    en: "Fictional no-term storage",
    es: "Almacenamiento ficticio sin permanencia",
    fr: "Stockage fictif sans engagement de durée",
    de: "Fiktiver Speicher ohne Mindestlaufzeit",
    ja: "期間の縛りのない架空のストレージ",
    pt: "Armazenamento fictício sem fidelidade",
    zh: "虚构的无合约期存储",
    ar: "تخزين افتراضي بدون مدة التزام",
  }),
  owner: demoText({
    en: "Demo commercial team",
    es: "Equipo comercial de la demostración",
    fr: "Équipe commerciale de démonstration",
    de: "Demo-Vertriebsteam",
    ja: "デモ営業チーム",
    pt: "Equipe comercial da demonstração",
    zh: "演示商务团队",
    ar: "الفريق التجاري للعرض التوضيحي",
  }),
  decisionReason: demoText({
    en: "Fictional proposal prepared by a different demo finance author.",
    es: "Propuesta ficticia preparada por otro autor de finanzas de la demostración.",
    fr: "Proposition fictive préparée par un autre auteur finance de la démo.",
    de: "Fiktiver Antrag, in der Demo von einer anderen Person aus der Finanzabteilung gestellt.",
    ja: "別のデモ用財務担当者が作成した架空の提案です。",
    pt: "Proposta fictícia preparada por outro autor financeiro da demonstração.",
    zh: "由另一位演示财务作者准备的虚构提案。",
    ar: "مقترح افتراضي أعدّه مؤلف مالي آخر في العرض التوضيحي.",
  }),
  serviceNotice: demoText({
    en: "Fictional demo only. Your request does not activate a provider tenant or start billing. A verified handoff is required before service begins.",
    es: "Solo es una demostración ficticia. Su solicitud no activa ningún inquilino del proveedor ni inicia la facturación. Antes de que empiece el servicio es necesario un traspaso verificado.",
    fr: "Démonstration fictive uniquement. Votre demande n’active aucun locataire chez le prestataire et ne déclenche pas la facturation. Une passation vérifiée est nécessaire avant le début du service.",
    de: "Nur fiktive Demo. Ihre Anfrage aktiviert keinen Mandanten beim Anbieter und startet keine Abrechnung. Vor Beginn des Services ist eine verifizierte Übergabe erforderlich.",
    ja: "架空のデモ専用です。この申請によってプロバイダーのテナントが有効化されたり、請求が開始されたりすることはありません。サービス開始前に、検証済みの引き継ぎが必要です。",
    pt: "Apenas demonstração fictícia. Sua solicitação não ativa um locatário do provedor nem inicia o faturamento. É necessário um encaminhamento verificado antes do início do serviço.",
    zh: "仅为虚构演示。您的申请不会开通服务商租户，也不会开始计费。服务开始前需要经过验证的交接。",
    ar: "عرض توضيحي افتراضي فقط. لا يؤدي طلبك إلى تفعيل مستأجر لدى المزوّد أو بدء الفوترة. يلزم تسليم موثّق قبل بدء الخدمة.",
  }),
  cancellationNotice: demoText({
    en: "Fictional demo only. Cancellation is a request until the provider confirms the service end. The retained offer controls any final billing minimum.",
    es: "Solo es una demostración ficticia. La cancelación es una solicitud hasta que el proveedor confirme el fin del servicio. La oferta registrada determina cualquier mínimo de facturación final.",
    fr: "Démonstration fictive uniquement. La résiliation reste une demande tant que le prestataire n’a pas confirmé la fin du service. L’offre conservée détermine l’éventuel minimum de facturation final.",
    de: "Nur fiktive Demo. Die Kündigung bleibt eine Anfrage, bis der Anbieter das Serviceende bestätigt. Ein etwaiger Mindestbetrag in der Schlussabrechnung richtet sich nach dem hinterlegten Tarif.",
    ja: "架空のデモ専用です。プロバイダーがサービス終了を確認するまで、解約は申請の扱いです。最終請求の最低料金は、保存されているオファーに従います。",
    pt: "Apenas demonstração fictícia. O cancelamento é uma solicitação até que o provedor confirme o fim do serviço. A oferta registrada define qualquer mínimo de faturamento final.",
    zh: "仅为虚构演示。在服务商确认服务终止之前，取消仅为申请。任何最终计费最低消费以已保留的方案为准。",
    ar: "عرض توضيحي افتراضي فقط. يظل الإلغاء طلبًا إلى أن يؤكد المزوّد انتهاء الخدمة. تحدد الباقة المحفوظة أي حد أدنى للفوترة النهائية.",
  }),
  trialNotice: demoText({
    en: "Fictional demo only. Trial eligibility is verified once for the organization and domain. No paid conversion occurs without your separate request.",
    es: "Solo es una demostración ficticia. El derecho al periodo de prueba se verifica una sola vez por organización y dominio. No se produce ninguna conversión a pago sin una solicitud aparte por su parte.",
    fr: "Démonstration fictive uniquement. L’éligibilité à l’essai est vérifiée une seule fois pour l’organisation et le domaine. Aucune conversion payante n’a lieu sans une demande distincte de votre part.",
    de: "Nur fiktive Demo. Die Berechtigung für die Testphase wird einmal für Organisation und Domain geprüft. Ohne Ihre gesonderte Anfrage erfolgt keine Umstellung auf kostenpflichtige Nutzung.",
    ja: "架空のデモ専用です。トライアルの利用資格は、組織とドメインについて1回だけ確認されます。別途お申し込みがない限り、有料プランへの移行は行われません。",
    pt: "Apenas demonstração fictícia. A elegibilidade ao período de teste é verificada uma única vez para a organização e o domínio. Nenhuma conversão paga ocorre sem uma solicitação separada sua.",
    zh: "仅为虚构演示。试用资格按组织和域名仅验证一次。未经您另行申请，不会转为付费。",
    ar: "عرض توضيحي افتراضي فقط. يُتحقق من أهلية الفترة التجريبية مرة واحدة للمؤسسة والنطاق. لا يحدث أي تحويل إلى الاشتراك المدفوع دون طلب منفصل منك.",
  }),
  channelEvidence: demoText({
    en: "Fictional demo channel program; not an approved live commercial policy.",
    es: "Programa de canal ficticio de la demostración; no es una política comercial real aprobada.",
    fr: "Programme partenaires fictif de la démo\u202f; il ne s’agit pas d’une politique commerciale réelle approuvée.",
    de: "Fiktives Demo-Partnerprogramm; keine genehmigte, produktive kaufmännische Richtlinie.",
    ja: "デモ用の架空のチャネルプログラムです。承認済みの実際の商用ポリシーではありません。",
    pt: "Programa de canal fictício da demonstração; não é uma política comercial real aprovada.",
    zh: "虚构的演示渠道计划；并非已批准的真实商务政策。",
    ar: "برنامج قناة افتراضي للعرض التوضيحي، وليس سياسة تجارية فعلية معتمدة.",
  }),
} as const satisfies Record<string, DemoLocalizedText>;

/** The fixture's source text, which is what the demo stores. */
const english = (text: DemoLocalizedText) => demoTextIn(text, "en");

/**
 * The reader's version of a demo-authored field: the first candidate whose
 * English equals the stored value, otherwise the stored value unchanged.
 */
function localizedField(
  value: string,
  candidates: readonly DemoLocalizedText[],
  locale: string,
): string {
  const fixture = candidates.find((candidate) => english(candidate) === value);
  return fixture ? demoTextIn(fixture, locale) : value;
}

/** A demo PAYG policy with its demo-authored text in the reader's language. */
export function localizeDemoPaygPolicy(
  record: PaygOfferRecord,
  locale: string,
): PaygOfferRecord {
  const acquisition = record.terms.customerAcquisition;
  return {
    ...record,
    decisionReason: localizedField(
      record.decisionReason,
      [fixtureText.decisionReason],
      locale,
    ),
    terms: {
      ...record.terms,
      name: localizedField(
        record.terms.name,
        [fixtureText.reviewScenarioName, fixtureText.noTermStorageName],
        locale,
      ),
      owner: localizedField(record.terms.owner, [fixtureText.owner], locale),
      ...(acquisition
        ? {
            customerAcquisition: {
              ...acquisition,
              serviceNotice: localizedField(
                acquisition.serviceNotice,
                [fixtureText.serviceNotice],
                locale,
              ),
              cancellationNotice: localizedField(
                acquisition.cancellationNotice,
                [fixtureText.cancellationNotice],
                locale,
              ),
              trialNotice: localizedField(
                acquisition.trialNotice,
                [fixtureText.trialNotice],
                locale,
              ),
            },
          }
        : {}),
    },
  };
}

/** A demo channel policy with its demo-authored text in the reader's language. */
export function localizeDemoChannelPolicy(
  record: ChannelPolicyRecord,
  locale: string,
): ChannelPolicyRecord {
  return {
    ...record,
    decisionReason: localizedField(
      record.decisionReason,
      [fixtureText.decisionReason],
      locale,
    ),
    terms: {
      ...record.terms,
      sourceEvidence: localizedField(
        record.terms.sourceEvidence,
        [fixtureText.channelEvidence],
        locale,
      ),
    },
  };
}
const prefix = "commercial-policy-demo:";
function assertDemo() {
  if (!demoDeployIdentityEnabled(process.env))
    throw new Error("DEMO_POLICY_UNAVAILABLE");
}
function seeds(now: string) {
  const base = {
    rowVersion: 2,
    status: "proposed",
    createdBy: author,
    lastEditedBy: author,
    proposedBy: author,
    approvedBy: null,
    decisionReason: english(fixtureText.decisionReason),
    createdAt: now,
    updatedAt: now,
  };
  return {
    payg: PaygOfferRecordSchema.parse({
      ...base,
      id: "61000000-0000-4000-8000-000000000001",
      approvalEvidenceId: null,
      terms: {
        name: english(fixtureText.reviewScenarioName),
        sku: "storage-standard",
        region: "us-east-1",
        version: 1,
        effectiveFrom: now.slice(0, 10),
        sourceUri: "https://example.test/fictional-policy",
        sourceCheckedAt: now,
        sourceDocumentId: "fictional-demo-source",
        owner: english(fixtureText.owner),
        payg: {
          currency: "USD",
          storageTbMonthMinor: "499",
          monthlyMinimumMinor: "499",
          partialMonthMinimum: "full",
          correctionWindowDays: 90,
          aggregation: "hourly_average_daily_utc",
          egressRateMinor: "0",
          apiRateMinor: "0",
          stripeTaxCode: "txcd_10103000",
          qboIncomeAccount: "4000",
        },
        trial: {
          durationDays: 30,
          gracePeriodDays: 7,
          storageLimitBytes: "1000000000000",
          cumulativeEgressLimitBytes: "2000000000000",
          maximumCounterAgeSeconds: 60,
          egressExhaustion: "disable_all",
        },
      },
    }),
    channel: ChannelPolicyRecordSchema.parse({
      ...base,
      id: "61000000-0000-4000-8000-000000000002",
      approvalEvidence: null,
      terms: {
        version: 1,
        effectiveFrom: now.slice(0, 10),
        selfServeThresholdTb: 100,
        defaultProtectionDays: 90,
        maximumProtectionDays: 90,
        extensionDays: 30,
        maximumExtensions: 2,
        sourceEvidence: english(fixtureText.channelEvidence),
      },
    }),
  };
}
export function currentDemoPaygPolicies(
  state: DemoAdapterState,
  now = new Date().toISOString(),
): PaygOfferRecord[] {
  const proposal = seeds(`${now.slice(0, 10)}T00:00:00.000Z`).payg;
  const customer = PaygOfferRecordSchema.parse({
    ...proposal,
    id: "61000000-0000-4000-8000-000000000003",
    rowVersion: 3,
    status: "approved",
    approvedBy: "21000000-0000-4000-8000-000000000011",
    approvalEvidenceId: "fictional-customer-request-policy",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    terms: {
      ...proposal.terms,
      name: english(fixtureText.noTermStorageName),
      effectiveFrom: "2026-07-01",
      sourceCheckedAt: "2026-07-01T00:00:00.000Z",
      region: "us-west-2",
      customerAcquisition: {
        paygRequestsEnabled: true,
        trialRequestsEnabled: true,
        serviceNotice: english(fixtureText.serviceNotice),
        cancellationNotice: english(fixtureText.cancellationNotice),
        trialNotice: english(fixtureText.trialNotice),
        terms: {
          documentId: "fictional-demo-terms",
          version: "1",
          uri: "https://example.test/fictional-terms",
          sha256: "a".repeat(64),
        },
        retention: {
          documentId: "fictional-demo-retention",
          version: "1",
          uri: "https://example.test/fictional-retention",
          sha256: "b".repeat(64),
        },
      },
    },
  });
  const found = new Map([
    [proposal.id, proposal],
    [customer.id, customer],
    ...records(state, "payg", proposal, PaygOfferRecordSchema).map(
      (row) => [row.id, row] as const,
    ),
  ]);
  return [...found.values()];
}
function records<T extends { id: string }>(
  state: DemoAdapterState,
  kind: string,
  seed: T,
  schema: z.ZodType<T>,
): T[] {
  const found = new Map([[seed.id, seed]]);
  for (const [key, entry] of Object.entries(state.projectionOverrides))
    if (key.startsWith(`${prefix}${kind}:`)) {
      const row = schema.parse(entry.data);
      found.set(row.id, row);
    }
  return [...found.values()];
}
export function currentDemoChannelPolicies(
  state: DemoAdapterState,
  now = new Date().toISOString(),
) {
  return records(
    state,
    "channel",
    seeds(now).channel,
    ChannelPolicyRecordSchema,
  );
}
export function currentDemoChannelPolicy(
  state: DemoAdapterState,
  now = new Date().toISOString(),
) {
  return channelPolicySnapshot(
    currentDemoChannelPolicies(state, now)
      .filter(
        (row) =>
          row.status === "approved" &&
          row.terms.effectiveFrom <= now.slice(0, 10),
      )
      .sort(
        (a, b) =>
          b.terms.effectiveFrom.localeCompare(a.terms.effectiveFrom) ||
          b.terms.version - a.terms.version,
      )[0],
  );
}
export class DemoCommercialPolicyRepository {
  constructor(
    private readonly store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {}
  async listPayg(now = new Date().toISOString()): Promise<PaygOfferRecord[]> {
    assertDemo();
    return currentDemoPaygPolicies(await this.store.read(), now);
  }
  async listChannel(
    now = new Date().toISOString(),
  ): Promise<ChannelPolicyRecord[]> {
    assertDemo();
    return currentDemoChannelPolicies(await this.store.read(), now);
  }
  async active(now = new Date().toISOString()) {
    assertDemo();
    return currentDemoChannelPolicy(await this.store.read(), now);
  }
  async commandPayg(input: {
    command: PaygOfferCommand;
    userId: string;
    requestId: string;
    now: string;
  }): Promise<PaygOfferRecord> {
    return PaygOfferRecordSchema.parse(await this.mutate("payg", input));
  }
  async commandChannel(input: {
    command: ChannelPolicyCommand;
    userId: string;
    requestId: string;
    now: string;
  }): Promise<ChannelPolicyRecord> {
    return ChannelPolicyRecordSchema.parse(await this.mutate("channel", input));
  }
  private async mutate(
    kind: "payg" | "channel",
    input: { command: unknown; userId: string; requestId: string; now: string },
  ) {
    assertDemo();
    const userId = z.uuid().parse(input.userId),
      now = z.iso.datetime().parse(input.now);
    const id = randomUUID(),
      receiptKey = `${prefix}receipt:${kind}:${userId}:${input.requestId}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input.command))
      .digest("hex");
    let result: PaygOfferRecord | ChannelPolicyRecord | undefined;
    await this.store.update((state) => {
      const receipt = state.projectionOverrides[receiptKey]?.data;
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new Error("DEMO_POLICY_IDEMPOTENCY_CONFLICT");
        result =
          kind === "payg"
            ? PaygOfferRecordSchema.parse(receipt.result)
            : ChannelPolicyRecordSchema.parse(receipt.result);
        return state;
      }
      const base = {
        id,
        rowVersion: 1,
        status: "draft",
        createdBy: userId,
        lastEditedBy: userId,
        proposedBy: null,
        approvedBy: null,
        decisionReason: "",
        createdAt: now,
        updatedAt: now,
      };
      if (kind === "payg") {
        const command = PaygOfferCommandSchema.parse(input.command),
          rows = currentDemoPaygPolicies(state, now);
        if (command.action === "create") {
          if (command.terms.sourceCheckedAt > now)
            throw new Error("PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE");
          result = PaygOfferRecordSchema.parse({
            ...base,
            terms: command.terms,
            approvalEvidenceId: null,
          });
        } else {
          const current = rows.find((row) => row.id === command.id);
          if (!current) throw new Error("PAYG_OFFER_NOT_FOUND");
          result = applyPaygOfferCommand({ current, command, userId, now });
        }
        const next = result;
        if (
          rows.some(
            (row) =>
              row.id !== next.id &&
              row.terms.version === next.terms.version &&
              row.terms.sku === next.terms.sku &&
              row.terms.region === next.terms.region,
          )
        )
          throw new Error("PAYG_OFFER_VERSION_EXISTS");
      } else {
        const command = ChannelPolicyCommandSchema.parse(input.command),
          rows = currentDemoChannelPolicies(state, now);
        if (command.action === "create")
          result = ChannelPolicyRecordSchema.parse({
            ...base,
            terms: command.terms,
            approvalEvidence: null,
          });
        else {
          const current = rows.find((row) => row.id === command.id);
          if (!current) throw new Error("CHANNEL_POLICY_NOT_FOUND");
          result = applyChannelPolicyCommand({ current, command, userId, now });
        }
        const next = result;
        if (
          rows.some(
            (row) =>
              row.id !== next.id &&
              (row.terms.version === next.terms.version ||
                (row.status === "approved" &&
                  next.status === "approved" &&
                  row.terms.effectiveFrom === next.terms.effectiveFrom)),
          )
        )
          throw new Error("CHANNEL_POLICY_VERSION_CONFLICT");
      }
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${prefix}${kind}:${result.id}`]: {
            version: result.rowVersion,
            updatedAt: now,
            data: { ...result },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              requestHash,
              result: { ...result },
              simulated: true,
              actorId: userId,
            },
          },
        },
      };
    });
    if (!result) throw new Error("DEMO_POLICY_WRITE_FAILED");
    return result;
  }
}
