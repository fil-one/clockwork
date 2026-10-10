import { MoneySchema } from "@clockwork/contracts";
import type { Currency, Money } from "@clockwork/contracts";

function assertSameCurrency(left: Money, right: Money): Currency {
  if (left.currency !== right.currency)
    throw new Error(
      `Currency mismatch: ${left.currency} and ${right.currency}`,
    );
  return left.currency;
}

export function money(currency: Currency, minor: bigint): Money {
  return MoneySchema.parse({ currency, minor: minor.toString() });
}

export function addMoney(left: Money, right: Money): Money {
  return money(
    assertSameCurrency(left, right),
    BigInt(left.minor) + BigInt(right.minor),
  );
}

export function subtractMoney(left: Money, right: Money): Money {
  return money(
    assertSameCurrency(left, right),
    BigInt(left.minor) - BigInt(right.minor),
  );
}
