import type { TaxPort } from "@clockwork/contracts";
import { MoneySchema } from "@clockwork/contracts";
import { z } from "zod";

import {
  providerTransportFailure,
  type ProviderJsonTransport,
} from "../../provider-transport";

const TaxIdentifierResponseSchema = z.object({
  valid: z.boolean(),
  normalized: z.string().trim().min(1).max(120),
  reverseChargeEligible: z.boolean(),
});

const TaxCalculationResponseSchema = z.object({
  tax: MoneySchema,
  treatment: z.enum(["standard", "reverse_charge", "exempt"]),
});

/**
 * Provider-neutral tax contract. The adapter carries no rate, no jurisdiction
 * list and no exemption rule: those are `EXT-TAX-01` inputs held by whichever
 * engine the transport is pointed at, and this class only refuses answers that
 * are not well formed. A reverse-charged or exempt supply must come back with
 * no amount — accepting a rate against it would silently bill a supply that is
 * billed net by definition.
 */
export class HttpTaxAdapter implements TaxPort {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async validateTaxId(
    input: Parameters<TaxPort["validateTaxId"]>[0],
  ): Promise<Awaited<ReturnType<TaxPort["validateTaxId"]>>> {
    try {
      const value = await this.transport.request({
        operation: "tax.validate_identifier",
        path: "/v1/tax/identifiers/validations",
        body: input,
        response: TaxIdentifierResponseSchema,
        idempotencyKey: `tax-identifier:${input.country}:${input.value}`,
      });
      if (!value.valid && value.reverseChargeEligible)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_IDENTIFIER_RESPONSE_INCONSISTENT",
          message:
            "Tax provider reported an invalid identifier as reverse-charge eligible",
        } as const;
      return { ok: true, value };
    } catch (error) {
      return providerTransportFailure(error, "TAX_PROVIDER_ERROR");
    }
  }

  public async calculate(
    input: Parameters<TaxPort["calculate"]>[0],
  ): Promise<Awaited<ReturnType<TaxPort["calculate"]>>> {
    try {
      const value = await this.transport.request({
        operation: "tax.calculate",
        path: "/v1/tax/calculations",
        body: input,
        response: TaxCalculationResponseSchema,
        idempotencyKey: `tax-calculation:${input.accountId}:${input.jurisdiction}:${input.lines
          .map((line) => `${line.taxCode}:${line.amount.minor}`)
          .join(",")}`,
      });
      const currency = input.lines[0]?.amount.currency;
      if (currency && value.tax.currency !== currency)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_CALCULATION_CURRENCY_MISMATCH",
          message: "Tax provider answered in a currency the lines do not use",
        } as const;
      if (value.treatment !== "standard" && BigInt(value.tax.minor) !== 0n)
        return {
          ok: false,
          kind: "permanent",
          code: "TAX_CALCULATION_TREATMENT_INCONSISTENT",
          message:
            "Tax provider charged an amount against a reverse-charged or exempt supply",
        } as const;
      return { ok: true, value };
    } catch (error) {
      return providerTransportFailure(error, "TAX_PROVIDER_ERROR");
    }
  }
}
