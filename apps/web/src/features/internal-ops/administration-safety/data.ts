import {
  demoText,
  resolveDemoText,
  type DemoTextField,
  type ResolvedDemoText,
} from "@clockwork/testing/demo-localized-text";

import type { MessageId } from "@/src/i18n";
import type { SupportedCurrency } from "@/src/features/shared/format";

import {
  gateGroups,
  gateSeverities,
  gateStates,
  type SafetyDecision,
} from "./policy";

/**
 * Demo fixtures for the administration and safety pages.
 *
 * Closed sets (kinds, jurisdictions, execution modes, states, scan results)
 * are keys that the components map to message IDs. Text that stands in for
 * what a person would have written in a real registry (case titles, gate
 * reasons, owners) is `demoText`, resolved for the reader by the page that
 * reads the fixture (policy rule 4). Names and identifiers are plain data.
 */

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
}

/** A selectable record whose description is demo-authored text. */
export interface DemoSelectOption {
  id: string;
  label: string;
  description?: DemoTextField;
}

export interface EvidenceIdentifierFixture {
  label: MessageId;
  value: string;
}

export type ApprovalCaseKind =
  "approval" | "rejection" | "offboarding" | "destructive";

/** How the case list summarizes a case: computed from facts, or case text. */
export type ApprovalCaseSummary =
  | {
      kind: "priceException";
      /** Fraction below the floor price, e.g. 0.017 for 1.7 %. */
      belowFloor: number;
      annualValueMinor: number;
      currency: SupportedCurrency;
    }
  | { kind: "text"; text: DemoTextField };

export interface ApprovalCase {
  id: string;
  label: DemoTextField;
  summary: ApprovalCaseSummary;
  decision: SafetyDecision;
  kind: ApprovalCaseKind;
  impact: DemoTextField;
  evidence: readonly DemoTextField[];
  policyBasis: DemoTextField;
  downstreamEffect: DemoTextField;
  owner: string;
  requestedBy: string;
  gates: readonly DemoTextField[];
  identifiers: readonly EvidenceIdentifierFixture[];
}

export const approvalCases: readonly ApprovalCase[] = [
  {
    id: "EXC-PRC-019",
    label: demoText({
      en: "Halcyon expansion price exception",
      es: "Excepción de precio para la ampliación de Halcyon",
      fr: "Exception tarifaire pour l’extension de Halcyon",
      de: "Preisausnahme für die Erweiterung von Halcyon",
      ja: "Halcyon の拡張に関する価格例外",
      pt: "Exceção de preço para a expansão da Halcyon",
      zh: "Halcyon 扩容价格例外",
      ar: "استثناء سعري لتوسعة Halcyon",
    }),
    summary: {
      kind: "priceException",
      belowFloor: 0.017,
      annualValueMinor: 18_480_000,
      currency: "USD",
    },
    decision: "finance",
    kind: "approval",
    impact: demoText({
      en: "Approves a below-floor quote for Halcyon Research Cooperative.",
      es: "Aprueba un presupuesto por debajo del precio mínimo para Halcyon Research Cooperative.",
      fr: "Approuve un devis inférieur au prix plancher pour Halcyon Research Cooperative.",
      de: "Genehmigt ein Angebot unter der Preisuntergrenze für Halcyon Research Cooperative.",
      ja: "Halcyon Research Cooperative 向けに、下限価格を下回る見積もりを承認します。",
      pt: "Aprova uma cotação abaixo do preço mínimo para a Halcyon Research Cooperative.",
      zh: "批准向 Halcyon Research Cooperative 出具低于底价的报价。",
      ar: "يوافق على عرض سعر أقل من الحد الأدنى للسعر لصالح Halcyon Research Cooperative.",
    }),
    evidence: [
      demoText({
        en: "Approved margin worksheet dated Jul 31",
        es: "Hoja de márgenes aprobada con fecha 31 de julio",
        fr: "Feuille de calcul des marges approuvée, datée du 31 juillet",
        de: "Genehmigte Margenberechnung vom 31. Juli",
        ja: "7月31日付けの承認済みマージン計算書",
        pt: "Planilha de margem aprovada, datada de 31 de julho",
        zh: "日期为 7 月 31 日的已批准利润率测算表",
        ar: "ورقة عمل الهامش المعتمدة بتاريخ 31 يوليو",
      }),
      demoText({
        en: "Partner tier and floor comparison",
        es: "Comparación entre el nivel del socio y el precio mínimo",
        fr: "Comparaison du niveau partenaire et du prix plancher",
        de: "Vergleich von Partnerstufe und Preisuntergrenze",
        ja: "パートナーランクと下限価格の比較",
        pt: "Comparação entre o nível do parceiro e o preço mínimo",
        zh: "合作伙伴级别与底价对比",
        ar: "مقارنة مستوى الشريك بالحد الأدنى للسعر",
      }),
      demoText({
        en: "Credit exposure remains within the finance threshold",
        es: "La exposición crediticia sigue dentro del umbral financiero",
        fr: "L’exposition au crédit reste sous le seuil financier",
        de: "Das Kreditrisiko liegt innerhalb des Schwellenwerts der Finanzabteilung",
        ja: "与信エクスポージャーは財務上の基準値内に収まっています",
        pt: "A exposição de crédito continua dentro do limite financeiro",
        zh: "信用敞口仍在财务阈值之内",
        ar: "يظل التعرض الائتماني ضمن الحد المالي",
      }),
    ],
    policyBasis: demoText({
      en: "Commercial approval policy CP-4.2; below-floor pricing requires finance authority.",
      es: "Política de aprobación comercial CP-4.2: los precios por debajo del mínimo requieren autoridad financiera.",
      fr: "Politique d’approbation commerciale CP-4.2\u00a0: un prix inférieur au plancher exige l’habilitation financière.",
      de: "Richtlinie für kaufmännische Genehmigungen CP-4.2: Preise unter der Preisuntergrenze erfordern die Befugnis der Finanzabteilung.",
      ja: "商用承認ポリシー CP-4.2：下限価格を下回る価格設定には財務権限が必要です。",
      pt: "Política de aprovação comercial CP-4.2: preços abaixo do mínimo exigem autoridade financeira.",
      zh: "商务审批政策 CP-4.2：低于底价的定价需要财务权限。",
      ar: "سياسة الموافقات التجارية CP-4.2: يتطلب التسعير دون الحد الأدنى صلاحية مالية.",
    }),
    downstreamEffect: demoText({
      en: "The quote may proceed to customer review; no order or invoice is created.",
      es: "El presupuesto puede pasar a revisión del cliente; no se crea ningún pedido ni ninguna factura.",
      fr: "Le devis peut passer à l’examen du client\u202f; aucune commande ni facture n’est créée.",
      de: "Das Angebot kann zur Prüfung an den Kunden gehen; es wird kein Auftrag und keine Rechnung erstellt.",
      ja: "見積もりは顧客の確認に進めます。注文も請求書も作成されません。",
      pt: "A cotação pode seguir para análise do cliente; nenhum pedido ou fatura é criado.",
      zh: "报价可进入客户审核；不会创建订单或发票。",
      ar: "يمكن أن ينتقل عرض السعر إلى مراجعة العميل؛ ولا يُنشأ أي طلب أو فاتورة.",
    }),
    owner: "James Ortega",
    requestedBy: "Amina Cole",
    gates: [
      demoText({
        en: "Credit clear",
        es: "Crédito sin incidencias",
        fr: "Crédit validé",
        de: "Bonitätsprüfung ohne Befund",
        ja: "与信確認済み",
        pt: "Crédito liberado",
        zh: "信用核查通过",
        ar: "الائتمان سليم",
      }),
      demoText({
        en: "Screening clear",
        es: "Verificación de cumplimiento sin incidencias",
        fr: "Filtrage de conformité validé",
        de: "Compliance-Screening ohne Befund",
        ja: "コンプライアンス審査済み",
        pt: "Triagem de conformidade liberada",
        zh: "合规筛查通过",
        ar: "فحص الامتثال سليم",
      }),
      demoText({
        en: "Provider capacity available",
        es: "Capacidad del proveedor disponible",
        fr: "Capacité du prestataire disponible",
        de: "Anbieterkapazität verfügbar",
        ja: "プロバイダーの容量に空きあり",
        pt: "Capacidade do provedor disponível",
        zh: "服务商容量充足",
        ar: "سعة المزوّد متاحة",
      }),
    ],
    identifiers: [
      {
        label: "adminGovernance.identifier.exceptionCase",
        value: "EXC-PRC-019",
      },
      {
        label: "adminGovernance.identifier.quote",
        value: "88888888-8888-4888-8888-888888888888",
      },
      {
        label: "adminGovernance.identifier.evidenceDocument",
        value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ],
  },
  {
    id: "EXC-LGL-011",
    label: demoText({
      en: "Northstar customer-paper exception",
      es: "Excepción de contrato del cliente de Northstar",
      fr: "Exception sur le contrat client de Northstar",
      de: "Ausnahme zum Kundenvertrag von Northstar",
      ja: "Northstar の顧客側契約書に関する例外",
      pt: "Exceção de contrato do cliente da Northstar",
      zh: "Northstar 客户合同例外",
      ar: "استثناء عقد العميل لدى Northstar",
    }),
    summary: {
      kind: "text",
      text: demoText({
        en: "Security addendum · two material variances",
        es: "Anexo de seguridad · dos desviaciones sustanciales",
        fr: "Annexe de sécurité · deux écarts substantiels",
        de: "Sicherheitsanhang · zwei wesentliche Abweichungen",
        ja: "セキュリティ付属書・重大な相違 2件",
        pt: "Adendo de segurança · duas divergências relevantes",
        zh: "安全附录 · 两处重大差异",
        ar: "ملحق الأمان · اختلافان جوهريان",
      }),
    },
    decision: "legal",
    kind: "rejection",
    impact: demoText({
      en: "Accepts or rejects customer language that changes the liability and audit terms.",
      es: "Acepta o rechaza redacción del cliente que modifica las cláusulas de responsabilidad y auditoría.",
      fr: "Accepte ou rejette une rédaction du client qui modifie les clauses de responsabilité et d’audit.",
      de: "Nimmt Formulierungen des Kunden an oder weist sie zurück, die die Haftungs- und Prüfungsbedingungen ändern.",
      ja: "責任条項と監査条項を変更する顧客側の文言を受け入れるか却下します。",
      pt: "Aceita ou rejeita a redação do cliente que altera os termos de responsabilidade e auditoria.",
      zh: "接受或驳回客户对责任和审计条款的修改措辞。",
      ar: "يقبل صياغة العميل التي تغيّر شروط المسؤولية والتدقيق أو يردّها.",
    }),
    evidence: [
      demoText({
        en: "Counsel redline against CSA v3.2",
        es: "Versión con control de cambios de la asesoría jurídica sobre el CSA v3.2",
        fr: "Version annotée du service juridique par rapport au CSA v3.2",
        de: "Redline der Rechtsabteilung gegenüber CSA v3.2",
        ja: "CSA v3.2 に対する法務の修正履歴",
        pt: "Marcações do jurídico no CSA v3.2",
        zh: "法务对照 CSA v3.2 的修订稿",
        ar: "تعديلات المستشار القانوني مقارنةً مع CSA v3.2",
      }),
      demoText({
        en: "Security schedule control mapping",
        es: "Correspondencia de controles del anexo de seguridad",
        fr: "Correspondance des contrôles de l’annexe de sécurité",
        de: "Zuordnung der Kontrollen im Sicherheitsanhang",
        ja: "セキュリティ別紙の管理策マッピング",
        pt: "Mapeamento de controles do anexo de segurança",
        zh: "安全附表控制项映射",
        ar: "مطابقة ضوابط ملحق الأمان",
      }),
      demoText({
        en: "Signed-text hash comparison completed",
        es: "Comparación del hash del texto firmado completada",
        fr: "Comparaison de l’empreinte du texte signé terminée",
        de: "Hash-Vergleich des unterzeichneten Texts abgeschlossen",
        ja: "署名済みテキストのハッシュ比較が完了",
        pt: "Comparação do hash do texto assinado concluída",
        zh: "已签署文本的哈希比对已完成",
        ar: "اكتملت مقارنة قيمة التجزئة للنص الموقّع",
      }),
    ],
    policyBasis: demoText({
      en: "Agreement policy AG-7; material customer-paper variances require counsel approval.",
      es: "Política de acuerdos AG-7: las desviaciones sustanciales en contratos del cliente requieren la aprobación de la asesoría jurídica.",
      fr: "Politique des accords AG-7\u00a0: tout écart substantiel dans un contrat client exige l’approbation du service juridique.",
      de: "Vereinbarungsrichtlinie AG-7: Wesentliche Abweichungen in Kundenverträgen erfordern die Genehmigung der Rechtsabteilung.",
      ja: "契約ポリシー AG-7：顧客側契約書の重大な相違には法務の承認が必要です。",
      pt: "Política de acordos AG-7: divergências relevantes em contratos de clientes exigem aprovação do jurídico.",
      zh: "协议政策 AG-7：客户合同中的重大差异需要法务审批。",
      ar: "سياسة الاتفاقيات AG-7: تتطلب الاختلافات الجوهرية في عقود العملاء موافقة المستشار القانوني.",
    }),
    downstreamEffect: demoText({
      en: "Approval unlocks counter-signature; rejection returns the redline to the account owner.",
      es: "La aprobación habilita la contrafirma; el rechazo devuelve la revisión al propietario de la cuenta.",
      fr: "L’approbation débloque la contre-signature\u202f; le rejet renvoie la version annotée au propriétaire du compte.",
      de: "Eine Genehmigung gibt die Gegenzeichnung frei; eine Zurückweisung gibt die Redline an den Kontoinhaber zurück.",
      ja: "承認するとカウンター署名が可能になり、却下すると修正履歴がアカウント所有者に差し戻されます。",
      pt: "A aprovação libera a contra-assinatura; a rejeição devolve as marcações ao proprietário da conta.",
      zh: "批准后即可会签；驳回则将修订稿退回账户所有者。",
      ar: "تتيح الموافقة التوقيع المقابل، ويعيد الردّ التعديلات إلى مالك الحساب.",
    }),
    owner: "Priya Nair",
    requestedBy: "James Ortega",
    gates: [
      demoText({
        en: "Screening clear",
        es: "Verificación de cumplimiento sin incidencias",
        fr: "Filtrage de conformité validé",
        de: "Compliance-Screening ohne Befund",
        ja: "コンプライアンス審査済み",
        pt: "Triagem de conformidade liberada",
        zh: "合规筛查通过",
        ar: "فحص الامتثال سليم",
      }),
      demoText({
        en: "Counsel authority required",
        es: "Se requiere autoridad de la asesoría jurídica",
        fr: "Habilitation du service juridique requise",
        de: "Befugnis der Rechtsabteilung erforderlich",
        ja: "法務の権限が必要",
        pt: "Autoridade do jurídico necessária",
        zh: "需要法务权限",
        ar: "تلزم صلاحية المستشار القانوني",
      }),
      demoText({
        en: "Execution provider ready",
        es: "Proveedor de formalización listo",
        fr: "Prestataire de signature électronique prêt",
        de: "Anbieter für den Abschluss von Vereinbarungen bereit",
        ja: "締結プロバイダーの準備完了",
        pt: "Provedor de assinatura pronto",
        zh: "签订服务商已就绪",
        ar: "مزوّد الإبرام جاهز",
      }),
    ],
    identifiers: [
      {
        label: "adminGovernance.identifier.exceptionCase",
        value: "EXC-LGL-011",
      },
      {
        label: "adminGovernance.identifier.agreement",
        value: "99999999-9999-4999-8999-999999999999",
      },
      {
        label: "adminGovernance.identifier.canonicalDocument",
        value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ],
  },
  {
    id: "APR-DEL-003",
    label: demoText({
      en: "Legacy analytics archive offboarding",
      es: "Baja del archivo de analítica heredado",
      fr: "Fin de service de l’ancienne archive analytique",
      de: "Offboarding des alten Analysearchivs",
      ja: "旧分析アーカイブの利用終了",
      pt: "Encerramento do arquivo legado de análises",
      zh: "旧版分析归档的服务终止",
      ar: "إنهاء خدمة أرشيف التحليلات القديم",
    }),
    summary: {
      kind: "text",
      text: demoText({
        en: "Retention exclusions · two-person teardown",
        es: "Exclusiones por conservación · desmantelamiento con dos personas",
        fr: "Exclusions de conservation · démantèlement à deux personnes",
        de: "Aufbewahrungsausnahmen · Rückbau nach dem Vier-Augen-Prinzip",
        ja: "保持による除外・2名体制での撤去",
        pt: "Exclusões de retenção · desmantelamento por duas pessoas",
        zh: "保留排除项 · 双人拆除",
        ar: "استثناءات الاحتفاظ · تفكيك بموافقة شخصين",
      }),
    },
    decision: "destructive",
    kind: "destructive",
    impact: demoText({
      en: "Authorizes deletion of unlocked objects after the retrieval window closes.",
      es: "Autoriza la eliminación de los objetos no bloqueados cuando se cierre el periodo de recuperación.",
      fr: "Autorise la suppression des objets non verrouillés après la fermeture de la période de récupération.",
      de: "Autorisiert das Löschen nicht gesperrter Objekte, sobald der Zeitraum für den Datenabruf abgelaufen ist.",
      ja: "取得期間の終了後に、ロックされていないオブジェクトの削除を許可します。",
      pt: "Autoriza a exclusão dos objetos não bloqueados após o fim do período de recuperação de dados.",
      zh: "授权在取回窗口关闭后删除未锁定的对象。",
      ar: "يأذن بحذف الكائنات غير المقفلة بعد انتهاء فترة الاسترجاع.",
    }),
    evidence: [
      demoText({
        en: "Customer retrieval notice acknowledged",
        es: "Aviso de recuperación confirmado por el cliente",
        fr: "Avis de récupération confirmé par le client",
        de: "Hinweis zum Datenabruf vom Kunden bestätigt",
        ja: "顧客が取得通知を確認済み",
        pt: "Aviso de recuperação de dados confirmado pelo cliente",
        zh: "客户已确认取回通知",
        ar: "أكّد العميل استلام إشعار الاسترجاع",
      }),
      demoText({
        en: "Four Object Lock exclusions preserved through Apr 15, 2027",
        es: "Cuatro exclusiones de Object Lock conservadas hasta el 15 de abril de 2027",
        fr: "Quatre exclusions Object Lock conservées jusqu’au 15 avril 2027",
        de: "Vier Object-Lock-Ausnahmen bis 15. April 2027 aufbewahrt",
        ja: "Object Lock による除外 4件を 2027年4月15日まで保持",
        pt: "Quatro exclusões de Object Lock preservadas até 15 de abril de 2027",
        zh: "4 项 Object Lock 排除项保留至 2027 年 4 月 15 日",
        ar: "الإبقاء على أربعة استثناءات Object Lock حتى 15 أبريل 2027",
      }),
      demoText({
        en: "Final credit and invoice check is clear",
        es: "La comprobación final de créditos y facturas no presenta incidencias",
        fr: "Le contrôle final des avoirs et des factures est concluant",
        de: "Abschließende Prüfung von Gutschriften und Rechnungen ohne Befund",
        ja: "最終的なクレジットと請求書の確認で問題なし",
        pt: "A verificação final de créditos e faturas não apresentou pendências",
        zh: "最终的贷项和发票核查未发现问题",
        ar: "لا توجد ملاحظات في الفحص النهائي للأرصدة الدائنة والفواتير",
      }),
    ],
    policyBasis: demoText({
      en: "Retention and teardown policy RT-9; two distinct approvers and recent authentication are mandatory.",
      es: "Política de conservación y desmantelamiento RT-9: son obligatorios dos aprobadores distintos y una autenticación reciente.",
      fr: "Politique de conservation et de démantèlement RT-9\u00a0: deux approbateurs distincts et une authentification récente sont obligatoires.",
      de: "Richtlinie für Aufbewahrung und Rückbau RT-9: Zwei verschiedene genehmigende Personen und eine aktuelle Authentifizierung sind Pflicht.",
      ja: "保持・撤去ポリシー RT-9：異なる 2名の承認者と直近の認証が必須です。",
      pt: "Política de retenção e desmantelamento RT-9: dois aprovadores distintos e autenticação recente são obrigatórios.",
      zh: "保留与拆除政策 RT-9：必须有两名不同的审批人并完成近期身份验证。",
      ar: "سياسة الاحتفاظ والتفكيك RT-9: يلزم موافِقان مختلفان ومصادقة حديثة.",
    }),
    downstreamEffect: demoText({
      en: "Creates an approval record only. Automation remains disabled until a second distinct approval and a server-side retention check.",
      es: "Solo crea un registro de aprobación. La automatización sigue desactivada hasta que haya una segunda aprobación distinta y una comprobación de conservación en el servidor.",
      fr: "Crée uniquement un enregistrement d’approbation. L’automatisation reste désactivée jusqu’à une seconde approbation distincte et un contrôle de conservation côté serveur.",
      de: "Erstellt nur einen Genehmigungsdatensatz. Die Automatisierung bleibt deaktiviert, bis eine zweite, unabhängige Genehmigung und eine serverseitige Aufbewahrungsprüfung vorliegen.",
      ja: "作成されるのは承認記録のみです。別の承認者による 2件目の承認とサーバー側の保持チェックが完了するまで、自動化は無効のままです。",
      pt: "Cria apenas um registro de aprovação. A automação continua desativada até uma segunda aprovação distinta e uma verificação de retenção no servidor.",
      zh: "仅创建审批记录。在获得第二个不同审批人的批准并完成服务器端保留检查之前，自动化保持禁用。",
      ar: "يُنشئ سجل موافقة فقط. تظل الأتمتة معطلة إلى أن تصدر موافقة ثانية من شخص مختلف ويُجرى فحص الاحتفاظ على الخادم.",
    }),
    owner: "Morgan Ellis",
    requestedBy: "Amina Cole",
    gates: [
      demoText({
        en: "Requester cannot approve",
        es: "El solicitante no puede aprobar",
        fr: "Le demandeur ne peut pas approuver",
        de: "Antragsteller darf nicht genehmigen",
        ja: "申請者は承認不可",
        pt: "O solicitante não pode aprovar",
        zh: "申请人不得审批",
        ar: "لا يجوز لمقدّم الطلب الموافقة",
      }),
      demoText({
        en: "Second distinct approver required",
        es: "Se requiere un segundo aprobador distinto",
        fr: "Second approbateur distinct requis",
        de: "Zweite, unabhängige genehmigende Person erforderlich",
        ja: "別の 2人目の承認者が必要",
        pt: "Segundo aprovador distinto necessário",
        zh: "需要第二名不同的审批人",
        ar: "يلزم موافِق ثانٍ مختلف",
      }),
      demoText({
        en: "Retention exclusions preserved",
        es: "Exclusiones por conservación mantenidas",
        fr: "Exclusions de conservation préservées",
        de: "Aufbewahrungsausnahmen erhalten",
        ja: "保持による除外を維持",
        pt: "Exclusões de retenção preservadas",
        zh: "保留排除项已保留",
        ar: "استثناءات الاحتفاظ محفوظة",
      }),
      demoText({
        en: "Credit due check clear",
        es: "Comprobación de créditos pendientes sin incidencias",
        fr: "Contrôle des avoirs dus concluant",
        de: "Prüfung fälliger Gutschriften ohne Befund",
        ja: "未処理クレジットの確認で問題なし",
        pt: "Verificação de créditos devidos sem pendências",
        zh: "应付贷项核查未发现问题",
        ar: "فحص الأرصدة الدائنة المستحقة سليم",
      }),
      demoText({
        en: "Provider deletion remains disabled",
        es: "La eliminación en el proveedor sigue desactivada",
        fr: "La suppression chez le prestataire reste désactivée",
        de: "Löschung beim Anbieter bleibt deaktiviert",
        ja: "プロバイダー側の削除は無効のまま",
        pt: "A exclusão no provedor continua desativada",
        zh: "服务商端删除仍处于禁用状态",
        ar: "يظل الحذف لدى المزوّد معطلًا",
      }),
    ],
    identifiers: [
      {
        label: "adminGovernance.identifier.approvalCase",
        value: "APR-DEL-003",
      },
      {
        label: "adminGovernance.identifier.termination",
        value: "55555555-5555-4555-8555-555555555555",
      },
      {
        label: "adminGovernance.identifier.retentionEvidenceHash",
        value: "73be9f02a19c7d98b177e4ea8f20f93b",
      },
    ],
  },
];

/** Demo accounts for assisted mode; the page resolves the descriptions. */
export const accounts: readonly DemoSelectOption[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Northstar Archive Labs",
    description: demoText({
      en: "Direct buyer · active",
      es: "Cliente directo · cuenta activa",
      fr: "Acheteur direct · compte actif",
      de: "Direktkunde · Konto aktiv",
      ja: "直接購入・アカウント有効",
      pt: "Comprador direto · conta ativa",
      zh: "直接客户 · 账户有效",
      ar: "مشترٍ مباشر · الحساب نشط",
    }),
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    label: "Halcyon Research Cooperative",
    description: demoText({
      en: "Resale end client · renewal in notice",
      es: "Cliente final de reventa · renovación en plazo de preaviso",
      fr: "Client final en revente · renouvellement en période de préavis",
      de: "Endkunde im Wiederverkauf · Verlängerung in der Kündigungsfrist",
      ja: "再販のエンド顧客・契約更新の通知期間中",
      pt: "Cliente final de revenda · renovação em aviso prévio",
      zh: "转售终端客户 · 续约处于通知期",
      ar: "عميل نهائي عبر إعادة البيع · التجديد ضمن فترة الإشعار",
    }),
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    label: "Atlas Field Imaging",
    description: demoText({
      en: "Distributor end client · screening review",
      es: "Cliente final de distribuidor · verificación de cumplimiento en curso",
      fr: "Client final d’un distributeur · filtrage de conformité en cours",
      de: "Endkunde eines Distributors · Compliance-Screening in Prüfung",
      ja: "ディストリビューター経由のエンド顧客・コンプライアンス審査中",
      pt: "Cliente final de distribuidor · triagem de conformidade em análise",
      zh: "分销商终端客户 · 合规筛查审核中",
      ar: "عميل نهائي لدى موزّع · فحص الامتثال قيد المراجعة",
    }),
  },
];

export type AgreementJurisdiction = "us" | "eu" | "uk";
export type AgreementExecution =
  "click_through" | "attached" | "counter_signed";
export type AgreementVersionState = "active" | "approved" | "draft" | "retired";
export type AgreementScan =
  "hashMatch" | "evidenceRequired" | "futureActivation";

export interface AgreementVersion {
  id: string;
  /** The template's name as its authors wrote it. */
  label: DemoTextField;
  type: string;
  version: string;
  jurisdiction: AgreementJurisdiction;
  execution: AgreementExecution;
  /** ISO calendar date. */
  effectiveOn: string;
  state: AgreementVersionState;
  scan: AgreementScan;
  textHash: string;
}

/** An agreement version with its demo text resolved for one reader. */
export type AgreementVersionView = ResolvedDemoText<AgreementVersion>;

/** When the demo version scan last read the registry (11:44 EDT). */
export const agreementScanAt = "2026-07-31T15:44:00.000Z";

const cloudServiceAgreement = demoText({
  en: "Cloud Service Agreement",
  es: "Acuerdo de servicios en la nube",
  fr: "Accord de services cloud",
  de: "Cloud-Servicevereinbarung",
  ja: "クラウドサービス契約",
  pt: "Acordo de serviços em nuvem",
  zh: "云服务协议",
  ar: "اتفاقية الخدمات السحابية",
});

export const agreementVersions: readonly AgreementVersion[] = [
  {
    id: "agtpl_csa_us_3_2",
    label: cloudServiceAgreement,
    type: "CSA",
    version: "3.2.0",
    jurisdiction: "us",
    execution: "click_through",
    effectiveOn: "2026-07-01",
    state: "active",
    scan: "hashMatch",
    textHash: "sha256:73be9f02…a19c",
  },
  {
    id: "agtpl_csa_us_3_3",
    label: cloudServiceAgreement,
    type: "CSA",
    version: "3.3.0",
    jurisdiction: "us",
    execution: "click_through",
    effectiveOn: "2026-09-01",
    state: "draft",
    scan: "evidenceRequired",
    textHash: "sha256:1844aa21…7d31",
  },
  {
    id: "agtpl_dpa_eu_2_1",
    label: demoText({
      en: "Data Processing Addendum",
      es: "Anexo de tratamiento de datos",
      fr: "Annexe relative au traitement des données",
      de: "Vereinbarung zur Auftragsverarbeitung",
      ja: "データ処理補遺",
      pt: "Adendo de tratamento de dados",
      zh: "数据处理附录",
      ar: "ملحق معالجة البيانات",
    }),
    type: "DPA",
    version: "2.1.0",
    jurisdiction: "eu",
    execution: "attached",
    effectiveOn: "2026-06-15",
    state: "active",
    scan: "hashMatch",
    textHash: "sha256:9e275ca8…cb42",
  },
  {
    id: "agtpl_csa_uk_1_4",
    label: cloudServiceAgreement,
    type: "CSA",
    version: "1.4.0",
    jurisdiction: "uk",
    execution: "counter_signed",
    effectiveOn: "2026-08-15",
    state: "approved",
    scan: "futureActivation",
    textHash: "sha256:525daa7e…13df",
  },
];

/** Closed-set keys of the gate register (see `gateGroups` in policy.ts). */
export type GateGroup = (typeof gateGroups)[keyof typeof gateGroups];
/** Activation-test outcome as the registry records it. */
export type GateTestStatus = "never" | "passed" | "failed";
export interface GateRecord {
  id: string;
  group: GateGroup;
  title: string;
  owner: string;
  capability: string;
  /** What the activation test covers: the simulator's own description. */
  activationTest: string;
  severity: (typeof gateSeverities)[keyof typeof gateSeverities];
  state: (typeof gateStates)[keyof typeof gateStates];
  /** Freshness as text, for records that carry no `updatedAt` fact. */
  freshness: string;
  reason: string;
  technicalEvidence?: string;
  configuredState?: string;
  effectiveState?: string;
  activationAllowed?: boolean;
  blockedReasons?: readonly string[];
  inputRequired?: string;
  reviewOn?: string | null;
  rowVersion?: number;
  /** ISO timestamp of the registry row; rendered in the reader's locale. */
  updatedAt?: string;
  /** Present on registry rows; fallback fixtures have no test result. */
  activationTestStatus?: GateTestStatus;
  activationTestedAt?: string | null;
}

/** Static demo rows never claim to have been refreshed by a live registry. */
export const fallbackGateFreshness =
  // i18n-exempt: English source of a fixture field; rendered as adminGovernance.gates.freshness.fallback
  "Fallback record — not read from the gate registry";

/** The gate fields a demo registry row carries as demo-authored text. */
export type DemoGateField =
  "title" | "owner" | "capability" | "activationTest" | "reason";

type GateFixture = Omit<GateRecord, DemoGateField | "freshness"> &
  Record<DemoGateField, DemoTextField>;

const gateFixtures: readonly GateFixture[] = [
  {
    id: "EXT-ACC-01",
    group: gateGroups.provider,
    title: demoText({
      en: "Hosted accounts and credentials",
      es: "Cuentas alojadas y credenciales",
      fr: "Comptes hébergés et identifiants",
      de: "Gehostete Konten und Zugangsdaten",
      ja: "ホスト環境のアカウントと認証情報",
      pt: "Contas hospedadas e credenciais",
      zh: "托管账户与凭证",
      ar: "الحسابات المستضافة وبيانات الاعتماد",
    }),
    owner: demoText({
      en: "Platform owner",
      es: "Responsable de plataforma",
      fr: "Responsable de la plateforme",
      de: "Plattformverantwortliche Person",
      ja: "プラットフォーム責任者",
      pt: "Responsável pela plataforma",
      zh: "平台负责人",
      ar: "مسؤول المنصة",
    }),
    capability: demoText({
      en: "Hosted runtime, MFA, and signed callbacks",
      es: "Entorno de ejecución alojado, MFA y devoluciones de llamada firmadas",
      fr: "Environnement d’exécution hébergé, MFA et webhooks signés",
      de: "Gehostete Laufzeitumgebung, MFA und signierte Callbacks",
      ja: "ホスト型ランタイム、MFA、署名付きコールバック",
      pt: "Ambiente de execução hospedado, MFA e callbacks assinados",
      zh: "托管运行时、MFA 和签名回调",
      ar: "بيئة التشغيل المستضافة والمصادقة متعددة العوامل (MFA) وعمليات رد الاتصال الموقّعة",
    }),
    activationTest: demoText({
      en: "Hosted credential suite not run",
      es: "Pruebas de credenciales alojadas sin ejecutar",
      fr: "Tests des identifiants hébergés non exécutés",
      de: "Testsuite für gehostete Zugangsdaten nicht ausgeführt",
      ja: "ホスト環境の認証情報テストは未実行",
      pt: "Testes de credenciais hospedadas não executados",
      zh: "托管凭证测试套件未运行",
      ar: "لم تُشغَّل اختبارات بيانات الاعتماد المستضافة",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Scoped hosted credentials and a passing callback test are required.",
      es: "Se requieren credenciales alojadas de alcance limitado y una prueba de devolución de llamada superada.",
      fr: "Des identifiants hébergés à portée limitée et un test de webhook réussi sont requis.",
      de: "Erforderlich sind gehostete Zugangsdaten mit eingeschränktem Geltungsbereich und ein bestandener Callback-Test.",
      ja: "スコープを限定したホスト環境の認証情報と、合格したコールバックテストが必要です。",
      pt: "São necessárias credenciais hospedadas com escopo definido e um teste de callback aprovado.",
      zh: "需要限定范围的托管凭证，以及通过的回调测试。",
      ar: "يلزم توفر بيانات اعتماد مستضافة محددة النطاق واجتياز اختبار رد الاتصال.",
    }),
    configuredState: "pending",
    effectiveState: "blocked",
    activationAllowed: false,
    blockedReasons: ["activation_test_missing", "evidence_missing"],
  },
  {
    id: "EXT-COMMERCIAL-01",
    group: gateGroups.operations,
    title: demoText({
      en: "Approved commercial model",
      es: "Modelo comercial aprobado",
      fr: "Modèle commercial approuvé",
      de: "Genehmigtes Geschäftsmodell",
      ja: "承認済みの商用モデル",
      pt: "Modelo comercial aprovado",
      zh: "已批准的商业模式",
      ar: "النموذج التجاري المعتمد",
    }),
    owner: demoText({
      en: "Commercial operations",
      es: "Operaciones comerciales",
      fr: "Opérations commerciales",
      de: "Commercial Operations",
      ja: "営業オペレーション",
      pt: "Operações comerciais",
      zh: "商务运营",
      ar: "العمليات التجارية",
    }),
    capability: demoText({
      en: "Quotes, commitments, floors, and renewals",
      es: "Presupuestos, compromisos, precios mínimos y renovaciones",
      fr: "Devis, engagements, prix planchers et renouvellements",
      de: "Angebote, Zusagen, Preisuntergrenzen und Verlängerungen",
      ja: "見積もり、コミットメント、下限価格、契約更新",
      pt: "Cotações, compromissos, preços mínimos e renovações",
      zh: "报价、承诺、底价和续约",
      ar: "عروض الأسعار والالتزامات والحدود الدنيا للأسعار والتجديدات",
    }),
    activationTest: demoText({
      en: "Golden quote fixtures pass; approval missing",
      es: "Los presupuestos de referencia pasan las pruebas; falta la aprobación",
      fr: "Les devis de référence passent les tests\u202f; approbation manquante",
      de: "Referenzangebote bestanden; Genehmigung fehlt",
      ja: "基準見積もりのテストは合格、承認は未取得",
      pt: "Cotações de referência aprovadas nos testes; falta a aprovação",
      zh: "基准报价测试通过；缺少审批",
      ar: "نجحت عروض الأسعار المرجعية في الاختبار؛ والموافقة غير متوفرة",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "A named approver and current pricing evidence are required.",
      es: "Se requieren un aprobador designado y evidencia de precios actualizada.",
      fr: "Un approbateur désigné nommément et une preuve tarifaire à jour sont requis.",
      de: "Erforderlich sind eine namentlich benannte genehmigende Person und ein aktueller Preisnachweis.",
      ja: "指名された承認者と、最新の価格の証跡が必要です。",
      pt: "São necessários um aprovador nomeado e evidência de preços atualizada.",
      zh: "需要指定的审批人和最新的定价证据。",
      ar: "يلزم تعيين موافِق بالاسم وتوفر دليل تسعير محدّث.",
    }),
    configuredState: "review",
    effectiveState: "blocked",
    activationAllowed: false,
    blockedReasons: ["review_missing_or_expired"],
  },
  {
    id: "EXT-PROVIDER-01",
    group: gateGroups.provider,
    title: demoText({
      en: "Production provider selections",
      es: "Selección de proveedores de producción",
      fr: "Choix des prestataires de production",
      de: "Auswahl der Produktionsanbieter",
      ja: "本番プロバイダーの選定",
      pt: "Seleção de provedores de produção",
      zh: "生产服务商选型",
      ar: "اختيار مزوّدي الإنتاج",
    }),
    owner: demoText({
      en: "Platform owner",
      es: "Responsable de plataforma",
      fr: "Responsable de la plateforme",
      de: "Plattformverantwortliche Person",
      ja: "プラットフォーム責任者",
      pt: "Responsável pela plataforma",
      zh: "平台负责人",
      ar: "مسؤول المنصة",
    }),
    capability: demoText({
      en: "E-sign, email, CRM, accounting, screening, and support",
      es: "Firma electrónica, correo electrónico, CRM, contabilidad, verificación de cumplimiento y soporte",
      fr: "Signature électronique, e-mail, CRM, comptabilité, filtrage de conformité et support",
      de: "E-Signatur, E-Mail, CRM, Buchhaltung, Compliance-Screening und Support",
      ja: "電子署名、メール、CRM、会計、コンプライアンス審査、サポート",
      pt: "Assinatura eletrônica, e-mail, CRM, contabilidade, triagem de conformidade e suporte",
      zh: "电子签名、电子邮件、CRM、会计、合规筛查和支持",
      ar: "التوقيع الإلكتروني والبريد الإلكتروني وإدارة علاقات العملاء (CRM) والمحاسبة وفحص الامتثال والدعم",
    }),
    activationTest: demoText({
      en: "Simulator passed; production credentials not tested",
      es: "Simulador superado; credenciales de producción sin probar",
      fr: "Simulateur validé\u202f; identifiants de production non testés",
      de: "Simulator bestanden; Produktionszugangsdaten nicht getestet",
      ja: "シミュレーターは合格、本番の認証情報は未テスト",
      pt: "Simulador aprovado; credenciais de produção não testadas",
      zh: "模拟器已通过；生产凭证未测试",
      ar: "نجح المحاكي؛ ولم تُختبر بيانات اعتماد الإنتاج",
    }),
    severity: gateSeverities.pathBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Scoped production credentials and named provider choices are required.",
      es: "Se requieren credenciales de producción de alcance limitado y la elección explícita de los proveedores.",
      fr: "Des identifiants de production à portée limitée et le choix nominatif des prestataires sont requis.",
      de: "Erforderlich sind Produktionszugangsdaten mit eingeschränktem Geltungsbereich und eine namentliche Auswahl der Anbieter.",
      ja: "スコープを限定した本番の認証情報と、プロバイダーの明示的な選定が必要です。",
      pt: "São necessárias credenciais de produção com escopo definido e a escolha explícita dos provedores.",
      zh: "需要限定范围的生产凭证，以及明确选定的服务商。",
      ar: "يلزم توفر بيانات اعتماد إنتاج محددة النطاق وتسمية المزوّدين المختارين.",
    }),
  },
  {
    id: "EXT-PROVISION-01",
    group: gateGroups.provider,
    title: demoText({
      en: "Product provisioning contract",
      es: "Contrato de aprovisionamiento del producto",
      fr: "Contrat de provisionnement du produit",
      de: "Schnittstellenvertrag für die Produktbereitstellung",
      ja: "製品プロビジョニングの契約",
      pt: "Contrato de provisionamento do produto",
      zh: "产品开通契约",
      ar: "عقد تهيئة المنتج",
    }),
    owner: demoText({
      en: "Provisioning lead",
      es: "Responsable de aprovisionamiento",
      fr: "Responsable du provisionnement",
      de: "Leitung Bereitstellung",
      ja: "プロビジョニング責任者",
      pt: "Líder de provisionamento",
      zh: "开通负责人",
      ar: "مسؤول التهيئة",
    }),
    capability: demoText({
      en: "Paid service activation",
      es: "Activación de servicios de pago",
      fr: "Activation des services payants",
      de: "Aktivierung kostenpflichtiger Services",
      ja: "有料サービスの有効化",
      pt: "Ativação de serviços pagos",
      zh: "付费服务开通",
      ar: "تفعيل الخدمات المدفوعة",
    }),
    activationTest: demoText({
      en: "Replay-safe simulator result is part of the fallback record",
      es: "El resultado del simulador, seguro ante reprocesos, forma parte del registro de respaldo",
      fr: "Le résultat du simulateur, sûr en cas de rejeu, fait partie de l’enregistrement de repli",
      de: "Das wiederholungssichere Simulatorergebnis ist Teil des Fallback-Datensatzes",
      ja: "再実行しても安全なシミュレーター結果はフォールバック記録に含まれます",
      pt: "O resultado do simulador, seguro para reexecução, faz parte do registro de contingência",
      zh: "可安全重放的模拟器结果包含在后备记录中",
      ar: "نتيجة المحاكي الآمنة لإعادة التشغيل جزء من السجل الاحتياطي",
    }),
    severity: gateSeverities.pathBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Authenticated product boundary is pending.",
      es: "El límite autenticado del producto está pendiente.",
      fr: "La frontière authentifiée du produit est en attente.",
      de: "Die authentifizierte Produktgrenze steht aus.",
      ja: "認証済みの製品境界は保留中です。",
      pt: "A fronteira autenticada do produto está pendente.",
      zh: "经过身份验证的产品边界尚待完成。",
      ar: "حدود المنتج المصادَق عليها قيد الانتظار.",
    }),
  },
  {
    id: "EXT-LEGAL-01",
    group: gateGroups.legal,
    title: demoText({
      en: "Counsel-approved legal policy",
      es: "Política legal aprobada por la asesoría jurídica",
      fr: "Politique juridique approuvée par le service juridique",
      de: "Von der Rechtsabteilung genehmigte Rechtsrichtlinie",
      ja: "法務承認済みの法的ポリシー",
      pt: "Política legal aprovada pelo jurídico",
      zh: "经法务批准的法律政策",
      ar: "السياسة القانونية المعتمدة من المستشار القانوني",
    }),
    owner: demoText({
      en: "General counsel",
      es: "Dirección de Asesoría Jurídica",
      fr: "Direction juridique",
      de: "Leitung Recht",
      ja: "法務責任者",
      pt: "Diretoria jurídica",
      zh: "总法律顾问",
      ar: "المستشار القانوني العام",
    }),
    capability: demoText({
      en: "Agreement publication and customer-paper approval",
      es: "Publicación de acuerdos y aprobación de contratos del cliente",
      fr: "Publication des accords et approbation des contrats clients",
      de: "Veröffentlichung von Vereinbarungen und Genehmigung von Kundenverträgen",
      ja: "契約の公開と顧客側契約書の承認",
      pt: "Publicação de acordos e aprovação de contratos de clientes",
      zh: "协议发布和客户合同审批",
      ar: "نشر الاتفاقيات والموافقة على عقود العملاء",
    }),
    activationTest: demoText({
      en: "Version fixtures pass; production hash not supplied",
      es: "Las versiones de prueba pasan; no se ha facilitado el hash de producción",
      fr: "Les versions de test passent\u202f; empreinte de production non fournie",
      de: "Versionstests bestanden; Produktions-Hash nicht geliefert",
      ja: "バージョンのテストは合格、本番ハッシュは未提供",
      pt: "Versões de teste aprovadas; hash de produção não fornecido",
      zh: "版本测试数据已通过；未提供生产哈希",
      ar: "نجحت إصدارات الاختبار؛ ولم تُقدَّم قيمة التجزئة الخاصة بالإنتاج",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Final hashes, thresholds, and policy versions are pending.",
      es: "Los hashes definitivos, los umbrales y las versiones de la política están pendientes.",
      fr: "Les empreintes définitives, les seuils et les versions de la politique sont en attente.",
      de: "Endgültige Hashes, Schwellenwerte und Richtlinienversionen stehen aus.",
      ja: "最終ハッシュ、しきい値、ポリシーのバージョンが未確定です。",
      pt: "Os hashes finais, os limites e as versões da política estão pendentes.",
      zh: "最终哈希、阈值和政策版本尚待确定。",
      ar: "قيم التجزئة النهائية والحدود وإصدارات السياسة قيد الانتظار.",
    }),
  },
  {
    id: "EXT-TAX-01",
    group: gateGroups.legal,
    title: demoText({
      en: "Tax and accounting policy",
      es: "Política fiscal y contable",
      fr: "Politique fiscale et comptable",
      de: "Steuer- und Buchhaltungsrichtlinie",
      ja: "税務・会計ポリシー",
      pt: "Política fiscal e contábil",
      zh: "税务与会计政策",
      ar: "السياسة الضريبية والمحاسبية",
    }),
    owner: demoText({
      en: "Finance controller",
      es: "Control financiero",
      fr: "Contrôleur financier",
      de: "Finanzcontrolling",
      ja: "財務管理責任者",
      pt: "Controladoria",
      zh: "财务主管",
      ar: "المراقب المالي",
    }),
    capability: demoText({
      en: "Country billing and tax calculation",
      es: "Facturación por país y cálculo de impuestos",
      fr: "Facturation par pays et calcul des taxes",
      de: "Länderspezifische Abrechnung und Steuerberechnung",
      ja: "国別の請求と税額計算",
      pt: "Faturamento por país e cálculo de impostos",
      zh: "分国家计费和税费计算",
      ar: "الفوترة حسب الدولة واحتساب الضرائب",
    }),
    activationTest: demoText({
      en: "US, ES, and UK fixture result is part of the fallback record",
      es: "El resultado de prueba de EE. UU., España y Reino Unido forma parte del registro de respaldo",
      fr: "Le résultat de test pour les États-Unis, l’Espagne et le Royaume-Uni fait partie de l’enregistrement de repli",
      de: "Das Testergebnis für USA, Spanien und Vereinigtes Königreich ist Teil des Fallback-Datensatzes",
      ja: "米国・スペイン・英国のテスト結果はフォールバック記録に含まれます",
      pt: "O resultado de teste de EUA, Espanha e Reino Unido faz parte do registro de contingência",
      zh: "美国、西班牙和英国的测试结果包含在后备记录中",
      ar: "نتيجة اختبار الولايات المتحدة وإسبانيا والمملكة المتحدة جزء من السجل الاحتياطي",
    }),
    severity: gateSeverities.pathBlocker,
    state: gateStates.review,
    reason: demoText({
      en: "Accountant approval is required before activation.",
      es: "Se requiere la aprobación de un contable antes de la activación.",
      fr: "L’approbation d’un comptable est requise avant l’activation.",
      de: "Vor der Aktivierung ist die Genehmigung durch die Buchhaltung erforderlich.",
      ja: "有効化の前に会計担当者の承認が必要です。",
      pt: "É necessária a aprovação de um contador antes da ativação.",
      zh: "激活前需要会计师审批。",
      ar: "تلزم موافقة المحاسب قبل التفعيل.",
    }),
  },
  {
    id: "EXT-BRAND-01",
    group: gateGroups.brand,
    title: demoText({
      en: "Approved production identity",
      es: "Identidad de marca aprobada para producción",
      fr: "Identité de marque approuvée pour la production",
      de: "Genehmigter Markenauftritt für die Produktion",
      ja: "承認済みの本番用ブランドアイデンティティ",
      pt: "Identidade de marca aprovada para produção",
      zh: "已批准的生产品牌形象",
      ar: "الهوية المعتمدة لبيئة الإنتاج",
    }),
    owner: demoText({
      en: "Brand lead",
      es: "Responsable de marca",
      fr: "Responsable de la marque",
      de: "Leitung Marke",
      ja: "ブランド責任者",
      pt: "Líder de marca",
      zh: "品牌负责人",
      ar: "مسؤول العلامة التجارية",
    }),
    capability: demoText({
      en: "Customer-facing marks, email, and documents",
      es: "Marcas, correos electrónicos y documentos visibles para el cliente",
      fr: "Marques, e-mails et documents destinés aux clients",
      de: "Marken, E-Mails und Dokumente für Kunden",
      ja: "顧客向けの商標、メール、書類",
      pt: "Marcas, e-mails e documentos voltados ao cliente",
      zh: "面向客户的标识、电子邮件和文档",
      ar: "العلامات والبريد الإلكتروني والمستندات الموجهة إلى العملاء",
    }),
    activationTest: demoText({
      en: "Neutral-token visual scan passed",
      es: "Revisión visual con tokens neutros superada",
      fr: "Contrôle visuel avec jetons neutres réussi",
      de: "Visuelle Prüfung mit neutralen Tokens bestanden",
      ja: "ニュートラルトークンでの目視確認に合格",
      pt: "Verificação visual com tokens neutros aprovada",
      zh: "中性令牌视觉检查已通过",
      ar: "نجح الفحص المرئي بالرموز المحايدة",
    }),
    severity: gateSeverities.high,
    state: gateStates.review,
    reason: demoText({
      en: "Approved assets and usage rules are pending.",
      es: "Los recursos gráficos aprobados y las normas de uso están pendientes.",
      fr: "Les éléments de marque approuvés et les règles d’utilisation sont en attente.",
      de: "Genehmigte Markenelemente und Nutzungsregeln stehen aus.",
      ja: "承認済みの素材と使用ルールが未確定です。",
      pt: "Os ativos aprovados e as regras de uso estão pendentes.",
      zh: "已批准的素材和使用规则尚待确定。",
      ar: "الأصول المعتمدة وقواعد الاستخدام قيد الانتظار.",
    }),
  },
  {
    id: "EXT-DOMAIN-01",
    group: gateGroups.brand,
    title: demoText({
      en: "Domains and callback records",
      es: "Dominios y registros de devolución de llamada",
      fr: "Domaines et webhooks",
      de: "Domains und Callback-Einträge",
      ja: "ドメインとコールバックのレコード",
      pt: "Domínios e registros de callback",
      zh: "域名和回调记录",
      ar: "النطاقات وسجلات رد الاتصال",
    }),
    owner: demoText({
      en: "Web platform",
      es: "Plataforma web",
      fr: "Plateforme web",
      de: "Web-Plattform",
      ja: "Web プラットフォーム",
      pt: "Plataforma web",
      zh: "Web 平台",
      ar: "فريق منصة الويب",
    }),
    capability: demoText({
      en: "Custom domains, TLS, callbacks, and sender records",
      es: "Dominios personalizados, TLS, devoluciones de llamada y registros de remitente",
      fr: "Domaines personnalisés, TLS, webhooks et enregistrements d’expéditeur",
      de: "Eigene Domains, TLS, Callbacks und Absendereinträge",
      ja: "カスタムドメイン、TLS、コールバック、送信者レコード",
      pt: "Domínios personalizados, TLS, callbacks e registros de remetente",
      zh: "自定义域名、TLS、回调和发件人记录",
      ar: "النطاقات المخصصة وشهادات TLS وعمليات رد الاتصال وسجلات المرسل",
    }),
    activationTest: demoText({
      en: "Local callback test passed; DNS test not run",
      es: "Prueba local de devolución de llamada superada; prueba de DNS sin ejecutar",
      fr: "Test local des webhooks réussi\u202f; test DNS non exécuté",
      de: "Lokaler Callback-Test bestanden; DNS-Test nicht ausgeführt",
      ja: "ローカルのコールバックテストは合格、DNS テストは未実行",
      pt: "Teste local de callback aprovado; teste de DNS não executado",
      zh: "本地回调测试已通过；DNS 测试未运行",
      ar: "نجح اختبار رد الاتصال المحلي؛ ولم يُشغَّل اختبار DNS",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Production DNS, TLS, and sender records are not verified.",
      es: "El DNS, el TLS y los registros de remitente de producción no están verificados.",
      fr: "Le DNS, le TLS et les enregistrements d’expéditeur de production ne sont pas vérifiés.",
      de: "DNS, TLS und Absendereinträge der Produktion sind nicht verifiziert.",
      ja: "本番の DNS、TLS、送信者レコードは検証されていません。",
      pt: "O DNS, o TLS e os registros de remetente de produção não estão verificados.",
      zh: "生产环境的 DNS、TLS 和发件人记录未经验证。",
      ar: "لم يتم التحقق من إعدادات DNS وشهادات TLS وسجلات المرسل في بيئة الإنتاج.",
    }),
  },
  {
    id: "EXT-APPROVERS-01",
    group: gateGroups.operations,
    title: demoText({
      en: "Named operations approvers",
      es: "Aprobadores de operaciones designados",
      fr: "Approbateurs des opérations désignés",
      de: "Benannte genehmigende Personen im Betrieb",
      ja: "指名済みの運用承認者",
      pt: "Aprovadores de operações nomeados",
      zh: "指定的运营审批人",
      ar: "موافِقو العمليات المسمَّون",
    }),
    owner: demoText({
      en: "Operations director",
      es: "Dirección de operaciones",
      fr: "Direction des opérations",
      de: "Leitung Betrieb",
      ja: "運用責任者",
      pt: "Diretoria de operações",
      zh: "运营总监",
      ar: "مدير العمليات",
    }),
    capability: demoText({
      en: "Queue ownership and segregated approvals",
      es: "Responsables de colas y aprobaciones con segregación de funciones",
      fr: "Responsabilité des files d’attente et approbations séparées",
      de: "Zuständigkeit für Warteschlangen und getrennte Genehmigungen",
      ja: "キューの担当と職務分離された承認",
      pt: "Responsáveis pelas filas e aprovações segregadas",
      zh: "队列归属和职责分离的审批",
      ar: "ملكية قوائم الانتظار والموافقات المنفصلة",
    }),
    activationTest: demoText({
      en: "Fictional rota coverage passed",
      es: "Cobertura de turnos ficticia superada",
      fr: "Couverture du planning fictif validée",
      de: "Abdeckung des fiktiven Dienstplans bestanden",
      ja: "架空の当番表でのカバレッジ確認に合格",
      pt: "Cobertura da escala fictícia aprovada",
      zh: "虚构值班表覆盖检查已通过",
      ar: "نجح اختبار تغطية جدول المناوبات الافتراضي",
    }),
    severity: gateSeverities.pathBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Primary, backup, finance, legal, and destructive actors must be named.",
      es: "Deben designarse los responsables principal, suplente, financiero, jurídico y de acciones destructivas.",
      fr: "Les intervenants principal, suppléant, financier, juridique et chargé des actions destructives doivent être désignés.",
      de: "Hauptverantwortliche, Vertretung sowie Zuständige für Finanzen, Recht und destruktive Aktionen müssen benannt werden.",
      ja: "主担当、副担当、財務、法務、破壊的操作の担当者を指名する必要があります。",
      pt: "Os responsáveis principal, substituto, financeiro, jurídico e por ações destrutivas devem ser nomeados.",
      zh: "必须指定主要、备用、财务、法务和破坏性操作的执行人。",
      ar: "يجب تسمية المسؤول الأساسي والاحتياطي والمالي والقانوني والمسؤول عن الإجراءات الإتلافية.",
    }),
  },
  {
    id: "EXT-TEARDOWN-01",
    group: gateGroups.operations,
    title: demoText({
      en: "Teardown authority",
      es: "Autoridad de desmantelamiento",
      fr: "Habilitation de démantèlement",
      de: "Befugnis für den Rückbau",
      ja: "撤去の権限",
      pt: "Autoridade de desmantelamento",
      zh: "拆除权限",
      ar: "صلاحية التفكيك",
    }),
    owner: demoText({
      en: "Security operations",
      es: "Operaciones de seguridad",
      fr: "Opérations de sécurité",
      de: "Sicherheitsbetrieb",
      ja: "セキュリティ運用",
      pt: "Operações de segurança",
      zh: "安全运营",
      ar: "عمليات الأمن",
    }),
    capability: demoText({
      en: "Retention-aware deletion",
      es: "Eliminación que respeta la conservación",
      fr: "Suppression respectant la conservation",
      de: "Löschung unter Beachtung der Aufbewahrung",
      ja: "保持を考慮した削除",
      pt: "Exclusão que respeita a retenção",
      zh: "遵循保留规则的删除",
      ar: "الحذف مع مراعاة الاحتفاظ",
    }),
    activationTest: demoText({
      en: "Two-person simulation passed; automation disabled",
      es: "Simulación con dos personas superada; automatización desactivada",
      fr: "Simulation à deux personnes réussie\u202f; automatisation désactivée",
      de: "Vier-Augen-Simulation bestanden; Automatisierung deaktiviert",
      ja: "2名体制のシミュレーションに合格、自動化は無効",
      pt: "Simulação com duas pessoas aprovada; automação desativada",
      zh: "双人模拟已通过；自动化已禁用",
      ar: "نجحت محاكاة الشخصين؛ والأتمتة معطلة",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.pending,
    reason: demoText({
      en: "Recent-authentication and provider authority tests remain pending.",
      es: "Las pruebas de autenticación reciente y de autoridad del proveedor siguen pendientes.",
      fr: "Les tests d’authentification récente et d’habilitation du prestataire restent en attente.",
      de: "Die Tests für aktuelle Authentifizierung und Anbieterbefugnis stehen weiterhin aus.",
      ja: "直近の認証とプロバイダー権限のテストは引き続き保留中です。",
      pt: "Os testes de autenticação recente e de autoridade do provedor continuam pendentes.",
      zh: "近期身份验证和服务商权限测试仍待完成。",
      ar: "لا تزال اختبارات المصادقة الحديثة وصلاحية المزوّد قيد الانتظار.",
    }),
  },
  {
    id: "EXT-MARKETPLACE-01",
    group: gateGroups.brand,
    title: demoText({
      en: "Marketplace identities and settlement",
      es: "Identidades y liquidación en marketplaces",
      fr: "Identités et règlement sur les marketplaces",
      de: "Marketplace-Identitäten und Abrechnung",
      ja: "マーケットプレイスの ID と精算",
      pt: "Identidades e liquidação em marketplaces",
      zh: "云市场身份与结算",
      ar: "هويات السوق الإلكتروني والتسوية",
    }),
    owner: demoText({
      en: "Marketplace operations",
      es: "Operaciones de marketplace",
      fr: "Opérations marketplace",
      de: "Marketplace-Betrieb",
      ja: "マーケットプレイス運用",
      pt: "Operações de marketplace",
      zh: "云市场运营",
      ar: "عمليات السوق الإلكتروني",
    }),
    capability: demoText({
      en: "Private offers, order identity, and settlement replay",
      es: "Ofertas privadas, identidad de pedidos y reproceso de liquidaciones",
      fr: "Offres privées, identité des commandes et rejeu des règlements",
      de: "Private Angebote, Auftragsidentität und Abrechnungswiederholung",
      ja: "プライベートオファー、注文の ID、精算の再実行",
      pt: "Ofertas privadas, identidade de pedidos e reexecução de liquidações",
      zh: "私有报价、订单标识和结算重放",
      ar: "العروض الخاصة وهوية الطلبات وإعادة تشغيل التسويات",
    }),
    activationTest: demoText({
      en: "Provider-boundary replay not run",
      es: "Reproceso en el límite del proveedor sin ejecutar",
      fr: "Rejeu à la frontière du prestataire non exécuté",
      de: "Wiederholung an der Anbietergrenze nicht ausgeführt",
      ja: "プロバイダー境界での再実行は未実施",
      pt: "Reexecução na fronteira do provedor não executada",
      zh: "服务商边界重放未运行",
      ar: "لم تُشغَّل إعادة التشغيل عند حدود المزوّد",
    }),
    severity: gateSeverities.pathBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "Marketplace identity and settlement replay must pass.",
      es: "Las pruebas de identidad de marketplace y de reproceso de liquidaciones deben superarse.",
      fr: "Les tests d’identité marketplace et de rejeu des règlements doivent réussir.",
      de: "Die Tests für Marketplace-Identität und Abrechnungswiederholung müssen bestanden werden.",
      ja: "マーケットプレイスの ID と精算の再実行テストに合格する必要があります。",
      pt: "Os testes de identidade do marketplace e de reexecução de liquidações precisam ser aprovados.",
      zh: "云市场身份和结算重放测试必须通过。",
      ar: "يجب اجتياز اختبارَي هوية السوق الإلكتروني وإعادة تشغيل التسويات.",
    }),
    configuredState: "pending",
    effectiveState: "blocked",
    activationAllowed: false,
    blockedReasons: ["activation_test_missing"],
  },
  {
    id: "EXT-MIGRATION-01",
    group: gateGroups.operations,
    title: demoText({
      en: "Production migration authority",
      es: "Autoridad de migración en producción",
      fr: "Habilitation de migration en production",
      de: "Befugnis für die Produktionsmigration",
      ja: "本番移行の権限",
      pt: "Autoridade de migração em produção",
      zh: "生产迁移权限",
      ar: "صلاحية الترحيل في الإنتاج",
    }),
    owner: demoText({
      en: "Migration lead",
      es: "Responsable de migración",
      fr: "Responsable de la migration",
      de: "Leitung Migration",
      ja: "移行責任者",
      pt: "Líder de migração",
      zh: "迁移负责人",
      ar: "مسؤول الترحيل",
    }),
    capability: demoText({
      en: "Snapshot, resume, rollback, and readback",
      es: "Instantánea, reanudación, reversión y relectura",
      fr: "Instantané, reprise, retour arrière et relecture",
      de: "Snapshot, Fortsetzen, Rollback und Rücklesen",
      ja: "スナップショット、再開、ロールバック、読み戻し",
      pt: "Snapshot, retomada, rollback e releitura",
      zh: "快照、恢复、回滚和回读",
      ar: "اللقطة والاستئناف والتراجع وإعادة القراءة",
    }),
    activationTest: demoText({
      en: "Local rehearsal passed; production evidence missing",
      es: "Ensayo local superado; falta evidencia de producción",
      fr: "Répétition locale réussie\u202f; preuve de production manquante",
      de: "Lokale Generalprobe bestanden; Produktionsnachweis fehlt",
      ja: "ローカルのリハーサルは合格、本番の証跡なし",
      pt: "Ensaio local aprovado; evidência de produção ausente",
      zh: "本地演练已通过；缺少生产证据",
      ar: "نجح التمرين المحلي؛ ودليل الإنتاج غير متوفر",
    }),
    severity: gateSeverities.launchBlocker,
    state: gateStates.blocked,
    reason: demoText({
      en: "A dated production-shaped rehearsal and rollback owner are required.",
      es: "Se requieren un ensayo fechado en condiciones de producción y un responsable de la reversión.",
      fr: "Une répétition datée dans des conditions de production et un responsable du retour arrière sont requis.",
      de: "Erforderlich sind eine datierte, produktionsnahe Generalprobe und eine verantwortliche Person für den Rollback.",
      ja: "日付入りの本番相当のリハーサルと、ロールバックの担当者が必要です。",
      pt: "São necessários um ensaio datado em condições de produção e um responsável pelo rollback.",
      zh: "需要一次注明日期、贴近生产环境的演练，以及回滚负责人。",
      ar: "يلزم إجراء تمرين مؤرخ بظروف مماثلة للإنتاج وتعيين مسؤول عن التراجع.",
    }),
    configuredState: "review",
    effectiveState: "blocked",
    activationAllowed: false,
    blockedReasons: ["evidence_missing"],
  },
];

/**
 * The fallback register in English, the fixtures' source language. The
 * operations lane seeds the demo registry from it and serves it when the
 * registry cannot be read; the page localizes it with `demoGateText`.
 */
export const fallbackGates: readonly GateRecord[] = gateFixtures.map(
  (fixture) => ({
    ...resolveDemoText(fixture, "en"),
    freshness: fallbackGateFreshness,
  }),
);

/**
 * For one reader: each demo gate's demo-authored fields as `[English, text]`.
 *
 * The demo registry stores the English seed and operators may overwrite the
 * owner, reason and required input. A field still equal to its English seed is
 * the fixture and is shown in the reader's language; an edited field is what
 * the operator typed and is shown as written. Only the page that reads a demo
 * or fallback register passes this map; the system registry never gets one.
 */
export type DemoGateText = Readonly<
  Record<string, Readonly<Record<DemoGateField, readonly [string, string]>>>
>;

export function demoGateText(locale: string): DemoGateText {
  return Object.fromEntries(
    gateFixtures.map((fixture) => [
      fixture.id,
      {
        title: [
          resolveDemoText(fixture.title, "en"),
          resolveDemoText(fixture.title, locale),
        ],
        owner: [
          resolveDemoText(fixture.owner, "en"),
          resolveDemoText(fixture.owner, locale),
        ],
        capability: [
          resolveDemoText(fixture.capability, "en"),
          resolveDemoText(fixture.capability, locale),
        ],
        activationTest: [
          resolveDemoText(fixture.activationTest, "en"),
          resolveDemoText(fixture.activationTest, locale),
        ],
        reason: [
          resolveDemoText(fixture.reason, "en"),
          resolveDemoText(fixture.reason, locale),
        ],
      },
    ]),
  );
}
