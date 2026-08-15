import { ids, MoneySchema } from "@clockwork/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { composedTaxProvider, configuredTaxProvider } from "./tax";

/**
 * Where the EXT-TAX-01 gate sits.
 *
 * It used to sit on the composition of the Core finance repository, which meant
 * an unconfigured deployment answered every `/v1/core/commands/*` write with
 * "Core-finance route dependencies are not configured" -- quote creation, price
 * books, deal registrations, all of it, on every surface. A control that blocks
 * a legitimate write is as serious as one that permits a wrong value, and P0-61
 * asked for neither: it asked that acceptance in a tax-bearing jurisdiction not
 * issue a zero-tax document.
 *
 * So the gate is the port's answer, not the repository's existence. These tests
 * pin both halves: unconfigured means every determination is refused, and
 * refused means `ok: false`, which `determineTax` in
 * packages/db/src/repositories/core/database-finance.ts turns into a refusal of
 * the command rather than a zero. The commands that ask are `orders:create`
 * (quote acceptance) and `invoices:create`; their refusals are proved against
 * the live database in database-finance.integration.test.ts.
 */
describe("EXT-TAX-01 tax provider composition", () => {
  const baseUrl = process.env.TAX_PROVIDER_BASE_URL;
  const token = process.env.TAX_PROVIDER_TOKEN;

  afterEach(() => {
    if (baseUrl === undefined) delete process.env.TAX_PROVIDER_BASE_URL;
    else process.env.TAX_PROVIDER_BASE_URL = baseUrl;
    if (token === undefined) delete process.env.TAX_PROVIDER_TOKEN;
    else process.env.TAX_PROVIDER_TOKEN = token;
  });

  it("names no provider when either half of the credential is missing", () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;
    expect(configuredTaxProvider()).toBeUndefined();

    process.env.TAX_PROVIDER_BASE_URL = "https://tax.provider.test";
    expect(configuredTaxProvider()).toBeUndefined();

    delete process.env.TAX_PROVIDER_BASE_URL;
    process.env.TAX_PROVIDER_TOKEN = "tax-provider-token";
    expect(configuredTaxProvider()).toBeUndefined();
  });

  it("still yields a port when unconfigured, and that port refuses every determination", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;
    const tax = composedTaxProvider();
    expect(tax).toBeDefined();

    const calculated = await tax.calculate({
      accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
      jurisdiction: "US",
      lines: [
        {
          taxCode: "txcd_demo",
          amount: MoneySchema.parse({ currency: "USD", minor: "1" }),
        },
      ],
    });
    expect(calculated.ok).toBe(false);
    expect(calculated).toMatchObject({
      kind: "permanent",
      code: "TAX_PROVIDER_NOT_CONFIGURED",
    });

    const validated = await tax.validateTaxId({ country: "US", value: "1234" });
    expect(validated.ok).toBe(false);
    expect(validated).toMatchObject({ code: "TAX_PROVIDER_NOT_CONFIGURED" });
  });

  it("never answers a zero-rate determination in place of a refusal", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;
    const calculated = await composedTaxProvider().calculate({
      accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
      jurisdiction: "ES",
      lines: [
        {
          taxCode: "txcd_demo",
          amount: MoneySchema.parse({ currency: "EUR", minor: "168000" }),
        },
      ],
    });
    // The defect this whole path exists to prevent: `ok: true` with a zero,
    // which reads as "this jurisdiction charges nothing" and is billed as one.
    expect(calculated).not.toMatchObject({ ok: true });
  });

  it("uses the real HTTP adapter once both halves are supplied", () => {
    process.env.TAX_PROVIDER_BASE_URL = "https://tax.provider.test";
    process.env.TAX_PROVIDER_TOKEN = "tax-provider-token";
    const configured = configuredTaxProvider();
    expect(configured).toBeDefined();
    expect(composedTaxProvider().constructor.name).toBe(
      configured?.constructor.name,
    );
  });
});
