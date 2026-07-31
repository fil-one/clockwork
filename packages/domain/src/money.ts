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

/** Basis points avoid binary floating point on every money path. */
export function multiplyBasisPoints(
  value: Money,
  basisPoints: number,
  rounding: "half_up" | "down" = "half_up",
): Money {
  if (!Number.isSafeInteger(basisPoints))
    throw new Error("Basis points must be a safe integer");
  const numerator = BigInt(value.minor) * BigInt(basisPoints);
  const offset =
    rounding === "half_up" ? 5_000n * (numerator < 0n ? -1n : 1n) : 0n;
  return money(value.currency, (numerator + offset) / 10_000n);
}
