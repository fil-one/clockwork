import type { TaxPort } from "@clockwork/contracts";
import {
  FetchJsonProviderTransport,
  HttpTaxAdapter,
} from "@clockwork/integrations";

/**
 * The tax engine the authoritative finance repository determines against.
 *
 * There is deliberately no fallback. An absent engine used to mean every
 * invoice was written net with a zero in the three `tax_minor` columns, which
 * is the defect P0-61 records; it now means the Core finance surface is not
 * composed at all. `EXT-TAX-01` supplies the endpoint and credential, and until
 * it does, quote acceptance and invoice creation fail closed rather than
 * under-invoicing a customer in a tax-bearing jurisdiction.
 */
export function configuredTaxProvider(): TaxPort | undefined {
  const baseUrl = process.env.TAX_PROVIDER_BASE_URL?.trim();
  const bearerToken = process.env.TAX_PROVIDER_TOKEN?.trim();
  if (!baseUrl || !bearerToken) return undefined;
  return new HttpTaxAdapter(
    new FetchJsonProviderTransport({
      baseUrl,
      bearerToken,
      provider: "tax",
      allowInsecureLocalhost: process.env.NODE_ENV !== "production",
    }),
  );
}

/** Fail-closed variant for a caller that has no `undefined` branch to take. */
export function requiredTaxProvider(): TaxPort {
  const provider = configuredTaxProvider();
  if (!provider) throw new Error("TAX_PROVIDER_NOT_CONFIGURED:EXT-TAX-01");
  return provider;
}
