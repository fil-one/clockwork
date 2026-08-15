import type { TaxPort } from "@clockwork/contracts";
import {
  FetchJsonProviderTransport,
  HttpTaxAdapter,
} from "@clockwork/integrations";

/**
 * The tax engine the authoritative finance repository determines against.
 *
 * There is deliberately no zero-rate fallback. An absent engine used to mean
 * every invoice was written net with a zero in the `tax_minor` columns, which
 * is the defect P0-61 records. `EXT-TAX-01` supplies the endpoint and
 * credential, and until it does, quote acceptance and invoice creation fail
 * closed rather than under-invoicing a customer in a tax-bearing jurisdiction.
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

const UNCONFIGURED: {
  ok: false;
  kind: "permanent";
  code: string;
  message: string;
} = {
  ok: false,
  kind: "permanent",
  code: "TAX_PROVIDER_NOT_CONFIGURED",
  message:
    "EXT-TAX-01 is not wired: set TAX_PROVIDER_BASE_URL and TAX_PROVIDER_TOKEN.",
};

/**
 * A provider that knows nothing and says so, for a composition that has no
 * endpoint to call.
 *
 * `ProviderResult.ok: false` is already how a real engine reports that it
 * cannot answer, and `determineTax` in the finance repository treats that as a
 * refusal rather than a zero -- so an unconfigured deployment refuses on
 * exactly the commands a real outage would refuse on, and on no others. That is
 * the whole point of using this instead of declining to build the repository:
 * the tax port has two call sites in the Core finance lane, `orders:create`
 * (quote acceptance) and `invoices:create`, and only those two can write a
 * `tax_minor`. Refusing to compose the repository refused all seventy-odd
 * commands of the lane, including quote creation, which never asks this port
 * anything.
 *
 * `validateTaxId` answers the same way: an identifier that cannot be checked is
 * unverified, and the registration path already refuses an unverified one.
 */
class UnconfiguredTaxProvider implements TaxPort {
  public validateTaxId(): ReturnType<TaxPort["validateTaxId"]> {
    return Promise.resolve(UNCONFIGURED);
  }

  public calculate(): ReturnType<TaxPort["calculate"]> {
    return Promise.resolve(UNCONFIGURED);
  }
}

/**
 * The tax port to compose the Core finance repository with: the real engine
 * when `EXT-TAX-01` has supplied one, and an engine that refuses every
 * determination when it has not.
 */
export function composedTaxProvider(): TaxPort {
  return configuredTaxProvider() ?? new UnconfiguredTaxProvider();
}
