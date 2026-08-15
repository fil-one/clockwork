import type { Money, TaxPort, TaxTreatment } from "@clockwork/contracts";
import { MoneySchema } from "@clockwork/contracts";

/**
 * Repository fixture standing in for an approved tax engine.
 *
 * Every figure it can return comes from the fixture handed to the constructor,
 * so no rate, no country list and no exemption rule is written into shipped
 * code — those are `EXT-TAX-01` inputs. A fixture with no rates states a
 * zero-rate `standard` determination, which is fixture data and never evidence
 * that a jurisdiction charges nothing.
 *
 * It exists here rather than beside `FakeTaxAdapter` because `@clockwork/db`
 * may not import `@clockwork/integrations` (dependency-cruiser layer rule), and
 * the repository's own suites need a determination source. Production
 * compositions use the HTTP adapter; this one must never be reachable from a
 * production runtime, exactly as `CLOCKWORK_ENABLE_SIMULATORS` is forbidden
 * there.
 */
export interface FixtureTaxRules {
  readonly rateBasisPoints?: Readonly<Record<string, number>>;
  readonly reverseChargeJurisdictions?: readonly string[];
  readonly exemptJurisdictions?: readonly string[];
  readonly reverseChargeIdentifierPrefixes?: readonly string[];
  /** Jurisdictions the fixture refuses outright, standing in for an outage. */
  readonly unavailableJurisdictions?: readonly string[];
}

export class FixtureTaxPort implements TaxPort {
  public constructor(private readonly rules: FixtureTaxRules = {}) {}

  public validateTaxId(input: Parameters<TaxPort["validateTaxId"]>[0]) {
    const normalized = input.value.replace(/\s/g, "").toUpperCase();
    return Promise.resolve({
      ok: true as const,
      value: {
        valid: normalized.length >= 5,
        normalized,
        reverseChargeEligible: (
          this.rules.reverseChargeIdentifierPrefixes ?? []
        ).some((prefix) => normalized.startsWith(prefix.toUpperCase())),
      },
    });
  }

  public calculate(input: Parameters<TaxPort["calculate"]>[0]) {
    const jurisdiction = input.jurisdiction.toUpperCase();
    if ((this.rules.unavailableJurisdictions ?? []).includes(jurisdiction))
      return Promise.resolve({
        ok: false as const,
        kind: "transient" as const,
        code: "TAX_PROVIDER_UNAVAILABLE",
        message: `No tax determination is available for ${jurisdiction}`,
      });
    const treatment: TaxTreatment = (
      this.rules.reverseChargeJurisdictions ?? []
    ).includes(jurisdiction)
      ? "reverse_charge"
      : (this.rules.exemptJurisdictions ?? []).includes(jurisdiction)
        ? "exempt"
        : "standard";
    // Half away from zero, so a negative line's tax mirrors the charge it
    // reverses instead of drifting toward zero.
    const minor =
      treatment === "standard"
        ? input.lines.reduce((total, line) => {
            const rate = BigInt(
              this.rules.rateBasisPoints?.[line.taxCode] ?? 0,
            );
            const product = BigInt(line.amount.minor) * rate;
            const magnitude = product < 0n ? -product : product;
            const rounded = (magnitude + 5_000n) / 10_000n;
            return total + (product < 0n ? -rounded : rounded);
          }, 0n)
        : 0n;
    const tax: Money = MoneySchema.parse({
      currency: input.lines[0]?.amount.currency ?? "USD",
      minor: minor.toString(),
    });
    return Promise.resolve({ ok: true as const, value: { tax, treatment } });
  }
}
