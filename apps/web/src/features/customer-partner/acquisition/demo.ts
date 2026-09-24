import "server-only";
import { randomUUID } from "node:crypto";
import {
  CustomerAcquisitionCommandSchema,
  ResolveAcquisitionCommandSchema,
  effectiveCustomerOffers,
  paygEvidenceHash,
  type CustomerAcquisitionCommand,
  type ResolveAcquisitionCommand,
  type CustomerAcquisitionOffer,
  type CustomerAcquisitionView,
  type CustomerAcquisitionRequest,
} from "@clockwork/domain/core";
import { demoPersonas } from "@clockwork/testing/personas";
import {
  demoText,
  resolveDemoText,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { currentDemoPaygPolicies } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { getLocale } from "@/src/i18n/server";
const prefix = "customer-acquisition-demo:";
/**
 * Every demo request is made for one fictional organization. Its name stands
 * in for what a customer would have typed, so it is demo-authored text: the
 * reads below state it in the reader's language, and a stored request keeps
 * only the English it was written with.
 */
const demoOrganizationName = demoText({
  en: "Fictional customer organization",
  es: "Organización cliente ficticia",
  fr: "Organisation cliente fictive",
  de: "Fiktive Kundenorganisation",
  ja: "架空の顧客組織",
  pt: "Organização cliente fictícia",
  zh: "虚构的客户组织",
  ar: "مؤسسة عميل افتراضية",
});
async function organizationName(): Promise<string> {
  return resolveDemoText(demoOrganizationName, await getLocale());
}
type OfferWording =
  "name" | "serviceNotice" | "trialNotice" | "cancellationNotice";
/**
 * The fictional customer offer's wording in every interface language.
 *
 * The offer is the commercial-policies demo fixture, and its terms are hashed
 * into the evidence fingerprint a request has to match, so that fixture keeps
 * one language. This read boundary shows the same wording in the reader's
 * language, for display only: the fingerprint is computed from the stored
 * terms and does not change. An entry applies only while the fixture still
 * says exactly its English, so an edit to the fixture shows the new English
 * rather than a stale translation.
 */
const demoOfferWording: Readonly<
  Record<string, Readonly<Partial<Record<OfferWording, DemoLocalizedText>>>>
> = {
  "61000000-0000-4000-8000-000000000003": {
    name: demoText({
      en: "Fictional no-term storage",
      es: "Almacenamiento ficticio sin permanencia",
      fr: "Stockage fictif sans engagement de durée",
      de: "Fiktiver Speicher ohne Laufzeit",
      ja: "架空の期間なしストレージ",
      pt: "Armazenamento fictício sem fidelidade",
      zh: "虚构的无期限存储",
      ar: "تخزين افتراضي بلا مدة التزام",
    }),
    serviceNotice: demoText({
      en: "Fictional demo only. Your request does not activate a provider tenant or start billing. A verified handoff is required before service begins.",
      es: "Solo es una demostración ficticia. Su solicitud no activa ningún inquilino en el proveedor ni inicia la facturación. Antes de que empiece el servicio se requiere un traspaso verificado.",
      fr: "Démonstration fictive uniquement. Votre demande n’active aucun locataire chez le prestataire et ne déclenche pas la facturation. Une passation vérifiée est nécessaire avant le début du service.",
      de: "Nur eine fiktive Demo. Ihre Anfrage aktiviert keinen Mandanten beim Anbieter und startet keine Abrechnung. Vor Beginn des Services ist eine verifizierte Übergabe erforderlich.",
      ja: "架空のデモです。この申請によってプロバイダーのテナントが有効化されたり、課金が開始されたりすることはありません。サービス開始前に、確認済みの引き継ぎが必要です。",
      pt: "Apenas uma demonstração fictícia. Sua solicitação não ativa um locatário no provedor nem inicia o faturamento. É necessário um encaminhamento verificado antes do início do serviço.",
      zh: "仅为虚构演示。您的申请不会在服务商处激活租户，也不会开始计费。服务开始前需要完成经验证的交接。",
      ar: "عرض توضيحي افتراضي فقط. لا يؤدي طلبك إلى تفعيل مستأجر لدى المزوّد ولا إلى بدء الفوترة. يلزم تسليم مُتحقق منه قبل بدء الخدمة.",
    }),
    trialNotice: demoText({
      en: "Fictional demo only. Trial eligibility is verified once for the organization and domain. No paid conversion occurs without your separate request.",
      es: "Solo es una demostración ficticia. La elegibilidad para el periodo de prueba se verifica una sola vez por organización y dominio. No se produce ninguna conversión a pago sin su solicitud independiente.",
      fr: "Démonstration fictive uniquement. L’éligibilité à l’essai est vérifiée une seule fois pour l’organisation et le domaine. Aucun passage à l’offre payante n’a lieu sans votre demande distincte.",
      de: "Nur eine fiktive Demo. Die Berechtigung für die Testphase wird einmal pro Organisation und Domain geprüft. Ohne Ihren gesonderten Antrag erfolgt keine Umstellung auf kostenpflichtige Nutzung.",
      ja: "架空のデモです。トライアルの利用資格は、組織とドメインごとに1回だけ確認されます。別途申請しない限り、有料への移行は行われません。",
      pt: "Apenas uma demonstração fictícia. A elegibilidade para o período de teste é verificada uma única vez por organização e domínio. Nenhuma conversão para serviço pago ocorre sem uma solicitação separada sua.",
      zh: "仅为虚构演示。试用资格按组织和域名仅验证一次。未经您单独申请，不会转为付费。",
      ar: "عرض توضيحي افتراضي فقط. يُتحقق من أهلية الفترة التجريبية مرة واحدة للمؤسسة والنطاق. لا يتم أي تحويل إلى الاستخدام المدفوع دون طلب منفصل منك.",
    }),
    cancellationNotice: demoText({
      en: "Fictional demo only. Cancellation is a request until the provider confirms the service end. The retained offer controls any final billing minimum.",
      es: "Solo es una demostración ficticia. La cancelación es una solicitud hasta que el proveedor confirma el fin del servicio. La oferta conservada determina cualquier mínimo de facturación final.",
      fr: "Démonstration fictive uniquement. La résiliation reste une demande jusqu’à ce que le prestataire confirme la fin du service. L’offre conservée détermine tout minimum de facturation final.",
      de: "Nur eine fiktive Demo. Die Kündigung bleibt eine Anfrage, bis der Anbieter das Serviceende bestätigt. Ein etwaiger Mindestbetrag in der Schlussabrechnung richtet sich nach dem hinterlegten Tarif.",
      ja: "架空のデモです。解約は、プロバイダーがサービス終了を確定するまでは申請の段階にとどまります。最終請求の最低料金は、保持されているオファーに従います。",
      pt: "Apenas uma demonstração fictícia. O cancelamento é uma solicitação até o provedor confirmar o fim do serviço. A oferta mantida determina qualquer mínimo de faturamento final.",
      zh: "仅为虚构演示。在服务商确认服务终止之前，取消仅为申请。最终账单的任何最低费用以保留的方案为准。",
      ar: "عرض توضيحي افتراضي فقط. يظل الإلغاء طلبًا إلى أن يؤكد المزوّد انتهاء الخدمة. تحدد الباقة المحفوظة أي حد أدنى للفوترة النهائية.",
    }),
  },
};
function worded(
  field: OfferWording,
  current: string,
  wording: Readonly<Partial<Record<OfferWording, DemoLocalizedText>>>,
  locale: string,
): string {
  const text = wording[field];
  return text && resolveDemoText(text, "en") === current
    ? resolveDemoText(text, locale)
    : current;
}
function localizedOffer(
  offer: CustomerAcquisitionOffer,
  locale: string,
): CustomerAcquisitionOffer {
  const wording = demoOfferWording[offer.id];
  if (!wording) return offer;
  return {
    ...offer,
    name: worded("name", offer.name, wording, locale),
    notices: {
      ...offer.notices,
      serviceNotice: worded(
        "serviceNotice",
        offer.notices.serviceNotice,
        wording,
        locale,
      ),
      trialNotice: worded(
        "trialNotice",
        offer.notices.trialNotice,
        wording,
        locale,
      ),
      cancellationNotice: worded(
        "cancellationNotice",
        offer.notices.cancellationNotice,
        wording,
        locale,
      ),
    },
  };
}
function enabled() {
  if (!demoDeployIdentityEnabled(process.env))
    throw new Error("DEMO_ACQUISITION_UNAVAILABLE");
}
function persona(userId: string) {
  const found = Object.values(demoPersonas).find(
    (entry) => entry.userId === userId,
  );
  if (!found) throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
  return found;
}
function rows(state: DemoAdapterState) {
  return Object.entries(state.projectionOverrides)
    .filter(([key]) => key.startsWith(prefix))
    .map(
      ([, entry]) =>
        entry.data as unknown as CustomerAcquisitionRequest & {
          requestHash: string;
        },
    );
}
export class DemoCustomerAcquisitionRepository {
  constructor(
    private readonly store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {}
  async list(input: {
    userId: string;
    accountId: string;
    now: string;
  }): Promise<CustomerAcquisitionView> {
    enabled();
    const actor = persona(input.userId);
    if (actor.isInternalStaff || actor.selectedAccountId !== input.accountId)
      throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
    const state = await this.store.read();
    const name = await organizationName();
    const locale = await getLocale();
    return {
      offers: effectiveCustomerOffers(
        currentDemoPaygPolicies(state, input.now),
        input.now,
      ).map((offer) => localizedOffer(offer, locale)),
      organizations: [
        {
          id: actor.organizationId,
          name,
          canRequest: ["owner", "admin"].includes(actor.role),
          providerMapped: false,
        },
      ],
      requests: rows(state)
        .filter((row) => row.accountId === input.accountId)
        .map((row) => ({
          ...row,
          organizationName: name,
          offer: localizedOffer(row.offer, locale),
        })),
    };
  }
  async listInternal(userId: string) {
    enabled();
    if (persona(userId).role !== "finance_approver")
      throw new Error("ACQUISITION_FINANCE_REQUIRED");
    const name = await organizationName();
    const locale = await getLocale();
    return rows(await this.store.read()).map((row) => ({
      ...row,
      organizationName: name,
      offer: localizedOffer(row.offer, locale),
    }));
  }
  async request(input: {
    command: CustomerAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    enabled();
    const command = CustomerAcquisitionCommandSchema.parse(input.command);
    const actor = persona(input.userId);
    if (
      actor.isInternalStaff ||
      actor.selectedAccountId !== command.accountId ||
      actor.organizationId !== command.organizationId ||
      !["owner", "admin"].includes(actor.role)
    )
      throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
    let result: CustomerAcquisitionRequest | undefined;
    await this.store.update((state) => {
      const current = rows(state);
      const hash = paygEvidenceHash({ command, userId: input.userId });
      const prior = current.find((row) => row.id === command.id);
      if (prior) {
        if (prior.requestHash !== hash)
          throw new Error("ACQUISITION_REPLAY_CONFLICT");
        result = prior;
        return state;
      }
      const offers = effectiveCustomerOffers(
        currentDemoPaygPolicies(state, input.now),
        input.now,
      );
      let offer;
      let trialId: string | null = null;
      let enrollmentId: string | null = null;
      if (command.kind === "cancel_payg") {
        const paid = current.find(
          (row) =>
            row.accountId === command.accountId &&
            row.organizationId === command.organizationId &&
            row.result?.kind === "payg" &&
            row.result.id === command.enrollmentId &&
            !row.result.endsAt,
        );
        if (!paid) throw new Error("ACQUISITION_ENROLLMENT_MISMATCH");
        offer = paid.offer;
        enrollmentId = command.enrollmentId;
      } else {
        offer = offers.find((row) => row.id === command.offerVersionId);
        if (
          !offer ||
          offer.rowVersion !== command.offerRowVersion ||
          offer.fingerprint !== command.offerFingerprint
        )
          throw new Error("ACQUISITION_OFFER_CHANGED");
        if (
          command.kind === "trial"
            ? !offer.notices.trialRequestsEnabled
            : !offer.notices.paygRequestsEnabled
        )
          throw new Error("ACQUISITION_KIND_UNAVAILABLE");
        if (
          command.kind === "trial" &&
          current.some(
            (row) =>
              row.organizationId === command.organizationId &&
              row.kind === "trial" &&
              row.status === "fulfilled",
          )
        )
          throw new Error("ACQUISITION_TRIAL_ALREADY_USED");
        if (command.kind === "convert_to_payg") {
          const trial = current.find(
            (row) =>
              row.accountId === command.accountId &&
              row.organizationId === command.organizationId &&
              row.result?.kind === "trial" &&
              row.result.id === command.trialId &&
              !row.result.convertedAt,
          );
          if (!trial) throw new Error("ACQUISITION_TRIAL_MISMATCH");
          trialId = command.trialId;
        }
      }
      if (
        current.some(
          (row) =>
            row.organizationId === command.organizationId &&
            row.status === "pending" &&
            (row.kind === command.kind ||
              (row.kind !== "cancel_payg" && command.kind !== "cancel_payg")),
        )
      )
        throw new Error("ACQUISITION_REQUEST_PENDING");
      result = {
        id: command.id,
        accountId: command.accountId,
        organizationId: command.organizationId,
        organizationName: resolveDemoText(demoOrganizationName, "en"),
        kind: command.kind,
        status: "pending",
        rowVersion: 1,
        acceptedAt: input.now,
        offer,
        reason: command.kind === "cancel_payg" ? command.reason : "",
        resolutionReason: null,
        trialId,
        enrollmentId,
        result: null,
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${prefix}${command.id}`]: {
            version: 1,
            updatedAt: input.now,
            data: { ...result, requestHash: hash, simulated: true },
          },
        },
      };
    });
    if (!result) throw new Error("ACQUISITION_SAVE_FAILED");
    return result;
  }
  async resolve(input: {
    command: ResolveAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    enabled();
    if (persona(input.userId).role !== "finance_approver")
      throw new Error("ACQUISITION_FINANCE_REQUIRED");
    const command = ResolveAcquisitionCommandSchema.parse(input.command);
    let result: CustomerAcquisitionRequest | undefined;
    await this.store.update((state) => {
      const current = rows(state);
      const prior = current.find((row) => row.id === command.id);
      if (
        !prior ||
        prior.status !== "pending" ||
        prior.rowVersion !== command.expectedRowVersion
      )
        throw new Error("ACQUISITION_REQUEST_CHANGED");
      result = {
        ...prior,
        status: command.decision,
        rowVersion: prior.rowVersion + 1,
        resolutionReason: command.reason,
      };
      const overrides = { ...state.projectionOverrides };
      if (command.decision === "fulfilled") {
        if (prior.kind === "trial") {
          const id = randomUUID();
          result.trialId = id;
          result.result = {
            kind: "trial",
            id,
            startsAt: input.now,
            endsAt: new Date(
              Date.parse(input.now) + prior.offer.trial.durationDays * 86400000,
            ).toISOString(),
            convertedAt: null,
            billingAuthority: null,
          };
        } else if (prior.kind === "cancel_payg") {
          const paid = current.find(
            (row) =>
              row.result?.id === prior.enrollmentId &&
              row.result.kind === "payg" &&
              !row.result.endsAt,
          );
          if (!paid?.result)
            throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
          result.result = { ...paid.result, endsAt: input.now };
          overrides[`${prefix}${paid.id}`] = {
            version: paid.rowVersion,
            updatedAt: input.now,
            data: { ...paid, result: result.result },
          };
        } else {
          const id = randomUUID();
          result.enrollmentId = id;
          result.result = {
            kind: "payg",
            id,
            startsAt: input.now,
            endsAt: null,
            convertedAt: null,
            billingAuthority: "fictional_demo",
          };
          if (prior.kind === "convert_to_payg") {
            const trial = current.find(
              (row) =>
                row.result?.id === prior.trialId &&
                row.result.kind === "trial" &&
                !row.result.convertedAt,
            );
            if (!trial?.result)
              throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
            overrides[`${prefix}${trial.id}`] = {
              version: trial.rowVersion,
              updatedAt: input.now,
              data: {
                ...trial,
                result: { ...trial.result, convertedAt: input.now },
              },
            };
          }
        }
      }
      overrides[`${prefix}${prior.id}`] = {
        version: result.rowVersion,
        updatedAt: input.now,
        data: {
          ...result,
          requestHash: prior.requestHash,
          simulated: true,
          resolvedBy: input.userId,
        },
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: overrides,
      };
    });
    if (!result) throw new Error("ACQUISITION_SAVE_FAILED");
    return result;
  }
}
