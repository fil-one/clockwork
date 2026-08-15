import { describe, expect, it } from "vitest";

import {
  applyEnvelopeEvent,
  applyRenewalPriceProtection,
  approveAgreementTemplate,
  assertCanonicalLegalText,
  assertRenewalPriceProtection,
  captureClickAcceptance,
  createAgreementTemplate,
  createCounterSignatureEnvelope,
  createCustomerPaperAgreement,
  createNextTemplateVersion,
  createOurPaperAgreement,
  decideExecutionRequirement,
  evaluateAgreementTerm,
  evaluateRenewalPriceProtection,
  executeClickThroughAgreement,
  executeCounterSignedAgreement,
  hashEvidence,
  hashExactText,
  ingestCounterSignatureEvidence,
  supersedeAgreement,
  transitionNegotiation,
  type AgreementTemplate,
  type AgreementTerm,
  type ImmutableEvidenceObject,
  type KeyTerms,
} from ".";

const now = "2026-07-31T16:00:00.000Z";

function evidence(
  kind: ImmutableEvidenceObject["kind"],
  sha256 = hashExactText(`${kind} bytes`),
): ImmutableEvidenceObject {
  return {
    documentId: `document-${kind}`,
    kind,
    sha256,
    storageKey: `sha256/${sha256}`,
    versionId: `version-${kind}`,
    retainedUntil: "2036-07-31T16:00:00.000Z",
    legalHold: false,
    malwareScan: "clean",
    recordedAt: now,
  };
}

function draftTemplate(input?: {
  id?: string;
  version?: string;
  text?: string;
  type?: "csa" | "msa" | "partner_agreement";
  mode?: "click_through" | "counter_signed";
  jurisdiction?: "US" | "EU" | "UK";
}): AgreementTemplate {
  const text = input?.text ?? "Cloud Service Agreement\nVersion 1.0.0\n";
  return createAgreementTemplate({
    id: input?.id ?? "template-csa-us-v1",
    seriesId: "csa-standard",
    type: input?.type ?? "csa",
    semanticVersion: input?.version ?? "1.0.0",
    jurisdiction: input?.jurisdiction ?? "US",
    variant: "standard",
    effectiveOn: "2026-07-31",
    executionMode: input?.mode ?? "click_through",
    canonicalText: text,
    canonicalDocument: evidence("canonical_text", hashExactText(text)),
    createdAt: now,
  });
}

function approvedTemplate(
  input?: Parameters<typeof draftTemplate>[0],
): AgreementTemplate {
  const template = draftTemplate(input);
  return approveAgreementTemplate(template, {
    approvalId: `approval-${template.id}`,
    approverUserId: "counsel-user",
    authority: "counsel",
    approvedAt: now,
    reviewedTextHash: template.textHash,
    note: "Approved exact canonical text for the selected jurisdiction.",
  });
}

const keyTerms: KeyTerms = {
  slaCreditSchedule: { availability_99_9: "10_percent" },
  liabilityCap: { currency: "USD", minor: "1000000" },
  breachNoticeHours: 24,
  renewalPriceProtectionBasisPoints: 500,
  auditRights: "Annual audit on thirty days notice.",
  retentionLiabilityRule: "liable_through_retention",
  customRetentionRule: null,
  survivalRules: [
    {
      clause: "payment",
      customClause: null,
      duration: { kind: "in_flight_orders" },
    },
    {
      clause: "confidentiality",
      customClause: null,
      duration: { kind: "fixed_days", days: 365 },
    },
    {
      clause: "data_protection",
      customClause: null,
      duration: { kind: "perpetual" },
    },
  ],
  customTerms: { price_protection: "capped" },
};

const term = {
  startsOn: "2026-08-01",
  endsOn: "2027-07-31",
  renewalType: "auto_renew" as const,
  renewalMonths: 12,
  noticeDays: 60,
  timeZone: "America/New_York",
};

function valueSnapshot(input?: {
  accountId?: string;
  before?: string;
  eventValue?: string;
}) {
  const payload = {
    snapshotId: "ledger-snapshot-1",
    accountId: input?.accountId ?? "account-northstar",
    source: "commerce_ledger" as const,
    capturedAt: "2026-07-31T15:59:00.000Z",
    commercialEventId: "order-event-1",
    cumulativeValueBeforeMinor: input?.before ?? "100000",
    commercialEventValueMinor: input?.eventValue ?? "200000",
    currency: "USD" as const,
  };
  return { ...payload, evidenceHash: hashEvidence(payload) };
}

function clickEvidenceFor(
  template: AgreementTemplate,
  agreementId = "agreement-click",
) {
  return captureClickAcceptance({
    evidenceId: "click-evidence-1",
    agreementId,
    legalEntityName: "Northstar Archive Ltd",
    template,
    exactTextPresented: template.canonicalText,
    identity: {
      userId: "user-owner",
      email: "owner@northstar.test",
      role: "owner",
      accountId: "account-northstar",
      organizationId: "organization-northstar",
    },
    acceptedAt: "2026-08-01T13:05:00.000-04:00",
    ipAddress: "2001:db8::10",
    uiContext: {
      route: "/agreements/agreement-click/accept",
      action: "accept_agreement",
      sessionId: "session-123",
      requestId: "request-123",
      userAgent: "Clockwork test browser",
      locale: "en-US",
    },
    authorityTitle: "Chief Executive Officer",
    authorityAttested: true,
    commercialValueSnapshot: valueSnapshot(),
    thresholdMinor: "1000000",
  });
}

describe("agreement template governance", () => {
  it("hashes exact canonical UTF-8 and refuses hidden normalization", () => {
    const template = draftTemplate();
    expect(template.textHash).toBe(hashExactText(template.canonicalText));
    expect(() => assertCanonicalLegalText("line one\r\nline two")).toThrow(
      "CANONICAL_TEXT_MUST_USE_LF",
    );
    expect(() => assertCanonicalLegalText("Cafe\u0301")).toThrow(
      "CANONICAL_TEXT_MUST_BE_NFC",
    );
  });

  it("requires counsel to approve the exact hash and freezes approved versions", () => {
    const template = draftTemplate();
    expect(() =>
      approveAgreementTemplate(template, {
        approvalId: "approval-wrong-hash",
        approverUserId: "counsel-user",
        authority: "counsel",
        approvedAt: now,
        reviewedTextHash: "0".repeat(64),
        note: "Reviewed a different artifact.",
      }),
    ).toThrow("COUNSEL_REVIEWED_HASH_MISMATCH");

    const approved = approvedTemplate();
    expect(approved.approvalStatus).toBe("approved");
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.canonicalDocument)).toBe(true);
    expect(() => {
      (approved as { semanticVersion: string }).semanticVersion = "9.0.0";
    }).toThrow(TypeError);
  });

  it("creates increasing, independent jurisdiction variants without mutating prior text", () => {
    const prior = approvedTemplate();
    const ukText = "Cloud Service Agreement\nVersion 1.1.0\nUK IDTA applies.\n";
    const next = createNextTemplateVersion(prior, {
      id: "template-csa-uk-v1-1",
      seriesId: prior.seriesId,
      type: "csa",
      semanticVersion: "1.1.0",
      jurisdiction: "UK",
      variant: "uk-idta",
      effectiveOn: "2026-09-01",
      executionMode: "click_through",
      canonicalText: ukText,
      canonicalDocument: evidence("canonical_text", hashExactText(ukText)),
      createdAt: now,
    });
    expect(next.jurisdiction).toBe("UK");
    expect(next.textHash).not.toBe(prior.textHash);
    expect(prior.semanticVersion).toBe("1.0.0");
    expect(() =>
      createNextTemplateVersion(prior, {
        id: "template-bad-version",
        seriesId: prior.seriesId,
        type: "csa",
        semanticVersion: "1.0.0",
        jurisdiction: "EU",
        variant: "scc",
        effectiveOn: "2026-09-01",
        executionMode: "click_through",
        canonicalText: ukText,
        canonicalDocument: evidence("canonical_text", hashExactText(ukText)),
        createdAt: now,
      }),
    ).toThrow("TEMPLATE_VERSION_NOT_INCREASING");
  });
});

describe("click-through execution and authority evidence", () => {
  it("captures the exact template/version, identity, authority, IP, UI, time and account-value evidence", () => {
    const template = approvedTemplate();
    const evidenceRecord = clickEvidenceFor(template);
    expect(evidenceRecord).toMatchObject({
      agreementId: "agreement-click",
      templateId: template.id,
      templateVersion: "1.0.0",
      templateTextHash: template.textHash,
      authorityTitle: "Chief Executive Officer",
      authorityAttested: true,
      authorityAttestation: "I am authorized to bind Northstar Archive Ltd",
      cumulativeValueBeforeMinor: "100000",
      commercialEventValueMinor: "200000",
      cumulativeValueAfterMinor: "300000",
      ipAddress: "2001:db8::10",
    });
    expect(evidenceRecord.evidenceHash).toMatch(/^[a-f0-9]{64}$/);

    const draft = createOurPaperAgreement({
      id: "agreement-click",
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      template,
      term,
      createdAt: now,
    });
    const executed = executeClickThroughAgreement(
      draft,
      evidenceRecord,
      keyTerms,
    );
    expect(executed.status).toBe("active");
    expect(executed.keyTerms.breachNoticeHours).toBe(24);
    expect(Object.isFrozen(executed.executionEvidence)).toBe(true);
  });

  it("rejects even one-byte text drift and the exact cumulative threshold boundary", () => {
    const template = approvedTemplate();
    expect(() =>
      captureClickAcceptance({
        ...{
          evidenceId: "click-evidence-drift",
          agreementId: "agreement-click",
          legalEntityName: "Northstar Archive Ltd",
          template,
          exactTextPresented: `${template.canonicalText} `,
          identity: clickEvidenceFor(template).identity,
          acceptedAt: now,
          ipAddress: "192.0.2.10",
          uiContext: clickEvidenceFor(template).uiContext,
          authorityTitle: "CEO",
          authorityAttested: true,
          commercialValueSnapshot: valueSnapshot({
            before: "0",
            eventValue: "10",
          }),
          thresholdMinor: "100",
        },
      }),
    ).toThrow("PRESENTED_TEXT_HASH_MISMATCH");

    expect(() =>
      captureClickAcceptance({
        evidenceId: "click-evidence-threshold",
        agreementId: "agreement-click",
        legalEntityName: "Northstar Archive Ltd",
        template,
        exactTextPresented: template.canonicalText,
        identity: clickEvidenceFor(template).identity,
        acceptedAt: now,
        ipAddress: "192.0.2.10",
        uiContext: clickEvidenceFor(template).uiContext,
        authorityTitle: "CEO",
        authorityAttested: true,
        commercialValueSnapshot: valueSnapshot({
          before: "80",
          eventValue: "20",
        }),
        thresholdMinor: "100",
      }),
    ).toThrow("COUNTER_SIGNATURE_REQUIRED");
  });

  it("binds cumulative value to the authoritative commerce-ledger snapshot", () => {
    const template = approvedTemplate();
    const snapshot = valueSnapshot({ before: "80", eventValue: "19" });
    expect(() =>
      captureClickAcceptance({
        evidenceId: "click-evidence-tampered-value",
        agreementId: "agreement-click",
        legalEntityName: "Northstar Archive Ltd",
        template,
        exactTextPresented: template.canonicalText,
        identity: clickEvidenceFor(template).identity,
        acceptedAt: now,
        ipAddress: "192.0.2.10",
        uiContext: clickEvidenceFor(template).uiContext,
        authorityTitle: "CEO",
        authorityAttested: true,
        commercialValueSnapshot: {
          ...snapshot,
          commercialEventValueMinor: "20",
        },
        thresholdMinor: "100",
      }),
    ).toThrow("VALUE_SNAPSHOT_HASH_MISMATCH");
  });

  it("requires re-execution for threshold, new versions, changed terms and partner agreements", () => {
    const template = approvedTemplate();
    expect(
      decideExecutionRequirement({
        template,
        commercialValueSnapshot: valueSnapshot({
          before: "900",
          eventValue: "100",
        }),
        thresholdMinor: "1000",
        activeAgreement: {
          executionMode: "click_through",
          templateId: template.id,
          templateTextHash: template.textHash,
        },
      }),
    ).toMatchObject({
      mode: "counter_signed",
      reexecutionRequired: true,
      reasons: ["CUMULATIVE_VALUE_THRESHOLD_REACHED"],
    });

    const changed = approvedTemplate({
      id: "template-csa-us-v2",
      version: "2.0.0",
    });
    expect(
      decideExecutionRequirement({
        template: changed,
        commercialValueSnapshot: valueSnapshot({
          before: "100",
          eventValue: "10",
        }),
        thresholdMinor: "1000",
        activeAgreement: {
          executionMode: "click_through",
          templateId: template.id,
          templateTextHash: template.textHash,
        },
        termsChanged: true,
      }).reasons,
    ).toEqual(["TEMPLATE_VERSION_CHANGED", "TERMS_CHANGED"]);

    const partner = approvedTemplate({
      id: "partner-template",
      type: "partner_agreement",
      mode: "counter_signed",
    });
    expect(
      decideExecutionRequirement({
        template: partner,
        commercialValueSnapshot: valueSnapshot({
          before: "0",
          eventValue: "0",
        }),
        thresholdMinor: "1000",
        activeAgreement: null,
      }).mode,
    ).toBe("counter_signed");
  });
});

describe("customer paper, counter-signing and replay safety", () => {
  it("requires clean immutable customer paper, completed PDF and certificate evidence", () => {
    let customerPaper = createCustomerPaperAgreement({
      id: "agreement-customer-paper",
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      customerPaper: evidence("customer_paper"),
      term,
      uploadedAt: now,
    });
    customerPaper = transitionNegotiation(customerPaper, "counsel_review");
    customerPaper = transitionNegotiation(customerPaper, "agreed");

    let envelope = createCounterSignatureEnvelope({
      envelopeId: "envelope-1",
      agreementId: customerPaper.id,
      provider: "sandbox-esign",
      idempotencyKey: "agreement-customer-paper:create-envelope:v1",
      signingMode: "redirect",
      signingUrl: "https://esign.test/envelopes/1",
      createdAt: now,
    });
    const completed = {
      providerEventId: "provider-event-completed",
      envelopeId: envelope.envelopeId,
      type: "completed" as const,
      occurredAt: "2026-08-02T12:00:00.000Z",
      signerEmail: "owner@northstar.test",
    };
    const completionResult = applyEnvelopeEvent(envelope, completed);
    expect(completionResult.outcome).toBe("applied");
    envelope = completionResult.envelope;
    expect(envelope.state).toBe("provider_completed");
    expect(() =>
      applyEnvelopeEvent(envelope, {
        providerEventId: "provider-event-declined-conflict",
        envelopeId: envelope.envelopeId,
        type: "declined",
        occurredAt: "2026-08-02T12:00:30.000Z",
        signerEmail: "owner@northstar.test",
      }),
    ).toThrow("ENVELOPE_TERMINAL_CONFLICT");

    const stale = applyEnvelopeEvent(envelope, {
      providerEventId: "provider-event-sent-late",
      envelopeId: envelope.envelopeId,
      type: "sent",
      occurredAt: "2026-08-01T10:00:00.000Z",
      signerEmail: null,
    });
    expect(stale.outcome).toBe("stale");
    envelope = stale.envelope;
    const replay = applyEnvelopeEvent(envelope, completed);
    expect(replay.outcome).toBe("duplicate");
    expect(replay.envelope).toBe(envelope);

    expect(() =>
      executeCounterSignedAgreement(customerPaper, envelope, keyTerms),
    ).toThrow("COUNTER_SIGNATURE_EVIDENCE_INCOMPLETE");
    envelope = ingestCounterSignatureEvidence(envelope, {
      signedPdf: evidence("signed_pdf"),
      completionCertificate: evidence("completion_certificate"),
      ingestedAt: "2026-08-02T12:01:00.000Z",
    });
    const executed = executeCounterSignedAgreement(
      customerPaper,
      envelope,
      keyTerms,
    );
    expect(executed).toMatchObject({
      paper: "theirs",
      negotiationStatus: "agreed",
      executionMode: "counter_signed",
      executionEvidence: {
        envelopeId: "envelope-1",
        providerEventIds: [
          "provider-event-completed",
          "provider-event-sent-late",
        ],
        signingMode: "redirect",
        signedPdf: { kind: "signed_pdf" },
        completionCertificate: { kind: "completion_certificate" },
      },
    });
    expect(() =>
      applyEnvelopeEvent(envelope, {
        providerEventId: "provider-event-conflict",
        envelopeId: envelope.envelopeId,
        type: "declined",
        occurredAt: "2026-08-02T12:02:00.000Z",
        signerEmail: "owner@northstar.test",
      }),
    ).toThrow("ENVELOPE_TERMINAL_CONFLICT");
  });

  it("rejects invalid negotiation jumps", () => {
    const customerPaper = createCustomerPaperAgreement({
      id: "agreement-invalid-negotiation",
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      customerPaper: evidence("customer_paper"),
      term,
      uploadedAt: now,
    });
    expect(() => transitionNegotiation(customerPaper, "agreed")).toThrow(
      "NEGOTIATION_TRANSITION_INVALID",
    );
  });
});

describe("supersession, term clocks and survival", () => {
  it("creates an immutable supersession version and applies survival rules", () => {
    const template = approvedTemplate();
    const priorDraft = createOurPaperAgreement({
      id: "agreement-prior",
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      template,
      term,
      createdAt: now,
    });
    const prior = executeClickThroughAgreement(
      priorDraft,
      clickEvidenceFor(template, priorDraft.id),
      keyTerms,
    );
    const replacementDraft = createOurPaperAgreement({
      id: "agreement-replacement",
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      template,
      term: { ...term, startsOn: "2027-08-01", endsOn: "2028-07-31" },
      createdAt: now,
    });
    const replacement = executeClickThroughAgreement(
      replacementDraft,
      clickEvidenceFor(template, replacementDraft.id),
      keyTerms,
    );
    const superseded = supersedeAgreement(prior, replacement, "2027-08-01");
    expect(superseded).toMatchObject({
      status: "superseded",
      supersededById: replacement.id,
      lifecycleVersion: 2,
    });
    expect(prior.status).toBe("active");

    expect(evaluateAgreementTerm(prior, "2027-06-01", true)).toMatchObject({
      status: "in_notice",
      noticeOpensOn: "2027-06-01",
    });
    expect(
      evaluateAgreementTerm(prior, "2027-08-15", true).activeSurvivalClauses,
    ).toEqual(["payment", "confidentiality", "data_protection"]);
    expect(
      evaluateAgreementTerm(prior, "2028-08-01", false).activeSurvivalClauses,
    ).toEqual(["data_protection"]);
  });
});

describe("renewal price protection", () => {
  function executedAgreement(input?: {
    id?: string;
    keyTerms?: KeyTerms;
    term?: AgreementTerm;
  }) {
    const template = approvedTemplate();
    const id = input?.id ?? "agreement-price-protected";
    const draft = createOurPaperAgreement({
      id,
      accountId: "account-northstar",
      legalEntityName: "Northstar Archive Ltd",
      template,
      term: input?.term ?? term,
      createdAt: now,
    });
    return executeClickThroughAgreement(
      draft,
      clickEvidenceFor(template, id),
      input?.keyTerms ?? keyTerms,
    );
  }

  const usd = (minor: string) => ({ currency: "USD" as const, minor });
  // Inside the notice window of the term that is being renewed.
  const pricedOn = "2027-06-15";

  it("caps an uplift at the negotiated percentage and states the overcharge", () => {
    const agreement = executedAgreement();
    const decision = applyRenewalPriceProtection({
      agreement,
      pricedOn,
      priorUnitPrice: usd("100000"),
      proposedUnitPrice: usd("110000"),
    });
    expect(decision).toMatchObject({
      withinProtection: false,
      exceededByMinor: "5000",
      enforcedUnitPrice: usd("105000"),
      protection: {
        binding: true,
        reason: "protected",
        basisPoints: 500,
        maximumUnitPrice: usd("105000"),
      },
    });
    expect(
      applyRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: usd("105000"),
      }),
    ).toMatchObject({ withinProtection: true, exceededByMinor: "0" });
    expect(() =>
      assertRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: usd("105001"),
      }),
    ).toThrow("RENEWAL_PRICE_PROTECTION_EXCEEDED");
  });

  it("truncates a fractional uplift rather than charging above the ceiling", () => {
    // 999 * 5% is 1048.95: the customer agreed to 1048, not to 1049.
    expect(
      evaluateRenewalPriceProtection({
        agreement: executedAgreement(),
        pricedOn,
        priorUnitPrice: usd("999"),
      }).maximumUnitPrice,
    ).toEqual(usd("1048"));
  });

  it("freezes the price when the protection is zero basis points", () => {
    const agreement = executedAgreement({
      keyTerms: { ...keyTerms, renewalPriceProtectionBasisPoints: 0 },
    });
    expect(
      evaluateRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
      }),
    ).toMatchObject({ binding: true, maximumUnitPrice: usd("100000") });
    expect(
      applyRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: usd("100001"),
      }),
    ).toMatchObject({
      withinProtection: false,
      exceededByMinor: "1",
      enforcedUnitPrice: usd("100000"),
    });
  });

  it("never lifts a renewal that lowers the price to the ceiling", () => {
    expect(
      applyRenewalPriceProtection({
        agreement: executedAgreement(),
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: usd("90000"),
      }),
    ).toMatchObject({
      withinProtection: true,
      enforcedUnitPrice: usd("90000"),
      exceededByMinor: "0",
    });
  });

  it("leaves an unprotected renewal alone", () => {
    const agreement = executedAgreement({
      keyTerms: { ...keyTerms, renewalPriceProtectionBasisPoints: null },
    });
    expect(
      applyRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: usd("400000"),
      }),
    ).toMatchObject({
      withinProtection: true,
      enforcedUnitPrice: usd("400000"),
      protection: {
        binding: false,
        reason: "not_negotiated",
        maximumUnitPrice: null,
      },
    });
  });

  it("lapses with the agreement but rolls with an auto-renewal", () => {
    const expiring = executedAgreement({
      id: "agreement-price-protected-expiring",
      term: { ...term, renewalType: "expires", renewalMonths: null },
    });
    expect(
      evaluateRenewalPriceProtection({
        agreement: expiring,
        pricedOn: "2027-08-15",
        priorUnitPrice: usd("100000"),
      }),
    ).toMatchObject({
      binding: false,
      reason: "agreement_not_in_force",
      maximumUnitPrice: null,
    });
    expect(
      evaluateRenewalPriceProtection({
        agreement: expiring,
        pricedOn,
        priorUnitPrice: usd("100000"),
      }),
    ).toMatchObject({ binding: true, maximumUnitPrice: usd("105000") });

    // An auto-renewing agreement is still in force in the term it renews into.
    expect(
      evaluateRenewalPriceProtection({
        agreement: executedAgreement(),
        pricedOn: "2027-08-15",
        priorUnitPrice: usd("100000"),
      }),
    ).toMatchObject({ binding: true, maximumUnitPrice: usd("105000") });
    expect(
      evaluateRenewalPriceProtection({
        agreement: { ...executedAgreement(), terminatedOn: "2027-03-01" },
        pricedOn,
        priorUnitPrice: usd("100000"),
      }),
    ).toMatchObject({ binding: false, reason: "agreement_not_in_force" });
  });

  it("refuses a ceiling it cannot derive", () => {
    const agreement = executedAgreement();
    expect(() =>
      evaluateRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("-100000"),
      }),
    ).toThrow("RENEWAL_PRICE_PROTECTION_BASIS_NOT_PRICEABLE");
    expect(() =>
      applyRenewalPriceProtection({
        agreement,
        pricedOn,
        priorUnitPrice: usd("100000"),
        proposedUnitPrice: { currency: "EUR", minor: "100000" },
      }),
    ).toThrow("RENEWAL_PRICE_CURRENCY_MISMATCH");
    expect(() =>
      evaluateRenewalPriceProtection({
        agreement,
        pricedOn: "2027-06-31",
        priorUnitPrice: usd("100000"),
      }),
    ).toThrow("RENEWAL_PRICE_DATE_INVALID");
  });
});
