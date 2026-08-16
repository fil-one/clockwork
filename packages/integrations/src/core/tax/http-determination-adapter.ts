import type {
  ProviderResult,
  TaxDeterminationPort,
  TaxDeterminationRequest,
  TaxDeterminationResult,
  TaxIdentifierValidation,
  TaxTreatment,
} from "@clockwork/contracts";
import { MinorUnitSchema } from "@clockwork/contracts";
import { z } from "zod";

import {
  providerTransportFailure,
  type ProviderJsonTransport,
} from "../../provider-transport";

/**
 * The provider's answer, in the shape the market already answers in.
 *
 * Stripe Tax `/v1/tax/calculations` returns `line_items.data[].tax_breakdown[]`
 * with a jurisdiction (country, state, level), a rate, a taxable amount, an
 * amount and a taxability reason. Avalara's `CreateTransaction` returns
 * `lines[].details[]` with `jurisCode`, `jurisType`, `rate`, `taxableAmount`,
 * `tax` and a taxability reason. Both are per line and per jurisdiction, and
 * both carry the reason a line was not taxed — which is why the port answers in
 * rows rather than in a single figure per line. Nothing here is lost in
 * translation from either.
 */
const BreakdownSchema = z
  .object({
    jurisdiction: z.string().trim().min(1).max(120),
    treatment: z.enum([
      "standard",
      "reverse_charge",
      "zero_rated",
      "exempt",
      "out_of_scope",
      "not_registered",
    ]),
    taxCode: z.string().trim().min(1).max(120),
    ruleBookId: z.string().trim().min(1).max(120),
    ruleBookVersion: z.number().int().nonnegative(),
    ratePpm: z.number().int().min(0).max(1_000_000),
    rateKind: z.string().trim().min(1).max(60),
    taxableMinor: MinorUnitSchema,
    taxMinor: MinorUnitSchema,
    legalBasis: z.string().trim().max(400).default(""),
    notation: z.string().trim().max(400).default(""),
  })
  .strict();

const RegistrationSchema = z
  .object({
    jurisdiction: z.string().trim().min(1).max(120),
    scheme: z.string().trim().min(1).max(120),
    number: z.string().trim().min(1).max(120),
    verifiedAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    evidenceReference: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

const DeterminationResponseSchema = z
  .object({
    determinationId: z.string().trim().min(1).max(120),
    placeOfSupply: z.array(z.string().trim().min(1).max(120)),
    confidence: z.enum(["determined", "review_required"]),
    reviewReasons: z.array(z.string().trim().min(1).max(200)).default([]),
    supplierRegistration: RegistrationSchema.optional(),
    customerRegistration: RegistrationSchema.optional(),
    rounding: z.enum(["line", "invoice"]),
    lines: z
      .array(BreakdownSchema.extend({ lineId: z.string().trim().min(1) }))
      .min(1),
    totals: z
      .object({
        currency: z.enum(["USD", "EUR", "GBP"]),
        netMinor: MinorUnitSchema,
        taxMinor: MinorUnitSchema,
        grossMinor: MinorUnitSchema,
        byTreatment: z
          .array(
            z
              .object({
                treatment: z.enum([
                  "standard",
                  "reverse_charge",
                  "zero_rated",
                  "exempt",
                  "out_of_scope",
                  "not_registered",
                ]),
                netMinor: MinorUnitSchema,
                taxMinor: MinorUnitSchema,
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
  })
  .strict();

const IdentifierResponseSchema = z
  .object({
    valid: z.boolean(),
    normalized: z.string().trim().min(1).max(120),
    reverseChargeEligible: z.boolean(),
    scheme: z.string().trim().min(1).max(120).optional(),
    verifiedAt: z.iso.datetime({ offset: true }),
    evidenceReference: z.string().trim().min(1).max(400),
  })
  .strict();

/** Only a standard-rated row may carry an amount. */
const chargeable = (treatment: TaxTreatment) => treatment === "standard";

/**
 * Provider-neutral determination transport. It carries no rate, no country list
 * and no exemption rule — those are rule-book rows held by whichever engine the
 * transport points at. What it does hold is the refusals, and they are the same
 * arithmetic the engine holds on the inside of the boundary: an answer whose
 * rows do not sum to its own tax total, whose treatment buckets do not sum to
 * the document, whose gross is not its net plus its tax, that answers against a
 * net other than the one it was sent, that charges against a supply billed net,
 * that answers in another currency, or that answers about a line nobody asked
 * about, is refused rather than persisted — and never quietly corrected.
 */
export class HttpTaxDeterminationAdapter implements TaxDeterminationPort {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async determine(
    request: TaxDeterminationRequest,
  ): Promise<ProviderResult<TaxDeterminationResult>> {
    try {
      const value = await this.transport.request({
        operation: "tax.determine",
        path: "/v1/tax/calculations",
        body: request as unknown as Readonly<Record<string, unknown>>,
        response: DeterminationResponseSchema,
        idempotencyKey: `tax-determination:${request.customer.accountId}:${request.documentType}:${request.taxPointDate}:${request.lines
          .map((line) => `${line.lineId}:${line.netAmount.minor}`)
          .join(",")}`,
      });
      const charged = value.lines.find(
        (line) => !chargeable(line.treatment) && BigInt(line.taxMinor) !== 0n,
      );
      if (charged)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_TREATMENT_INCONSISTENT",
          message: `Provider charged ${charged.taxMinor} against a ${charged.treatment} supply on line ${charged.lineId}`,
        } as const;
      const summed = value.lines.reduce(
        (total, line) => total + BigInt(line.taxMinor),
        0n,
      );
      const netMinor = BigInt(value.totals.netMinor);
      const taxMinor = BigInt(value.totals.taxMinor);
      if (summed !== taxMinor)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_TOTALS_INCONSISTENT",
          message: "Provider line tax does not sum to the total it reported",
        } as const;
      /*
       * The document's own arithmetic, checked on the way in.
       *
       * These are the invariants the engine holds where we own the code, and a
       * third-party provider can return exactly the shape the engine was fixed
       * to stop producing: buckets summing to 200000 against a 100000 document,
       * or a gross that is not its own net plus its own tax. Persisting either
       * puts a wrong number on a ledger that reconciles against nothing.
       *
       * A violation is REFUSED, never repaired. Recomputing the totals we think
       * the provider meant would hide a provider defect behind our arithmetic,
       * and a provider disagreeing with us about a document total is a fact an
       * operator has to see.
       */
      if (netMinor + taxMinor !== BigInt(value.totals.grossMinor))
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_GROSS_INCONSISTENT",
          message: `Provider reported gross ${value.totals.grossMinor} against net ${value.totals.netMinor} plus tax ${value.totals.taxMinor}`,
        } as const;
      /*
       * The buckets are validated when the provider states any. An answer that
       * omits `byTreatment` entirely asserts nothing about the split and is not
       * refused for it — refusing there would block every provider that does
       * not publish the breakdown, which is the control-blocks-legitimate-work
       * failure rather than a defence against it.
       */
      const buckets = value.totals.byTreatment;
      if (buckets.length > 0) {
        const duplicated =
          buckets.length !==
          new Set(buckets.map((bucket) => bucket.treatment)).size;
        if (duplicated)
          return {
            ok: false,
            kind: "permanent",
            code: "TAX_DETERMINATION_TREATMENT_BUCKET_DUPLICATED",
            message:
              "Provider stated the same treatment in more than one bucket, so no bucket is the answer for it",
          } as const;
        const bucketNet = buckets.reduce(
          (total, bucket) => total + BigInt(bucket.netMinor),
          0n,
        );
        const bucketTax = buckets.reduce(
          (total, bucket) => total + BigInt(bucket.taxMinor),
          0n,
        );
        if (bucketNet !== netMinor || bucketTax !== taxMinor)
          return {
            ok: false,
            kind: "permanent",
            code: "TAX_DETERMINATION_TREATMENT_TOTALS_INCONSISTENT",
            message: `Provider treatment buckets sum to net ${bucketNet} and tax ${bucketTax} against a document of net ${value.totals.netMinor} and tax ${value.totals.taxMinor}`,
          } as const;
      }
      const currencies = new Set(
        request.lines.map((line) => line.netAmount.currency),
      );
      // A document spanning currencies has no net to compare against — the sum
      // below would be a number in no currency at all. The engine refuses such
      // a document; so does the boundary, and it says which refusal it is
      // rather than reporting it as a disagreement about the total.
      if (currencies.size > 1)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_CURRENCY_MIXED",
          message: "A determination cannot span currencies",
        } as const;
      if (!currencies.has(value.totals.currency))
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_CURRENCY_MISMATCH",
          message: "Provider answered in a currency the lines do not use",
        } as const;
      const requestedNet = request.lines.reduce(
        (total, line) => total + BigInt(line.netAmount.minor),
        0n,
      );
      if (requestedNet !== netMinor)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_NET_MISMATCH",
          message: `Provider answered against a net of ${value.totals.netMinor}; the document sent was ${requestedNet}`,
        } as const;
      const unknownLine = value.lines.find(
        (line) =>
          !request.lines.some((requested) => requested.lineId === line.lineId),
      );
      if (unknownLine)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_DETERMINATION_LINE_UNKNOWN",
          message: `Provider answered for line ${unknownLine.lineId}, which was not asked about`,
        } as const;
      return { ok: true, value: value as TaxDeterminationResult } as const;
    } catch (error) {
      return providerTransportFailure(error, "TAX_PROVIDER_ERROR");
    }
  }

  public async validateTaxId(input: {
    country: string;
    value: string;
    checkedAt: string;
  }): Promise<ProviderResult<TaxIdentifierValidation>> {
    try {
      const parsed = await this.transport.request({
        operation: "tax.validate_identifier",
        path: "/v1/tax/identifiers/validations",
        body: input,
        response: IdentifierResponseSchema,
        idempotencyKey: `tax-identifier:${input.country}:${input.value}:${input.checkedAt}`,
      });
      const value: TaxIdentifierValidation = {
        valid: parsed.valid,
        normalized: parsed.normalized,
        reverseChargeEligible: parsed.reverseChargeEligible,
        ...(parsed.scheme === undefined ? {} : { scheme: parsed.scheme }),
        verifiedAt: parsed.verifiedAt,
        evidenceReference: parsed.evidenceReference,
      };
      if (!value.valid && value.reverseChargeEligible)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_IDENTIFIER_RESPONSE_INCONSISTENT",
          message:
            "Tax provider reported an invalid identifier as reverse-charge eligible",
        } as const;
      return { ok: true, value } as const;
    } catch (error) {
      return providerTransportFailure(error, "TAX_PROVIDER_ERROR");
    }
  }
}
