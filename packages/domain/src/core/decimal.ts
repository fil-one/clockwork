const QUANTITY_SCALE = 10n ** 18n;

export type RoundingMode = "down" | "half_up";

export function parseDecimal(value: string, allowNegative = false): bigint {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))
    throw new Error(`Invalid decimal quantity: ${value}`);
  if (!allowNegative && value.startsWith("-"))
    throw new Error("Quantity cannot be negative");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled =
    BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(18, "0"));
  return negative ? -scaled : scaled;
}

export function formatDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = (absolute % QUANTITY_SCALE)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function divideRound(
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode = "half_up",
): bigint {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  if (rounding === "down") return numerator / denominator;
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

export function multiplyQuantity(
  left: string,
  right: string,
  rounding: RoundingMode = "half_up",
): string {
  return formatDecimal(
    divideRound(
      parseDecimal(left) * parseDecimal(right),
      QUANTITY_SCALE,
      rounding,
    ),
  );
}

export function addQuantities(...values: readonly string[]): string {
  return formatDecimal(
    values.reduce((sum, value) => sum + parseDecimal(value, true), 0n),
  );
}

export function compareQuantities(left: string, right: string): number {
  const delta = parseDecimal(left, true) - parseDecimal(right, true);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function multiplyMinorByQuantity(
  minor: bigint,
  quantity: string,
  multiplier = 1n,
  basisPoints = 10_000,
  rounding: RoundingMode = "half_up",
): bigint {
  if (!Number.isSafeInteger(basisPoints))
    throw new Error("Basis points must be a safe integer");
  return divideRound(
    minor * parseDecimal(quantity) * multiplier * BigInt(basisPoints),
    QUANTITY_SCALE * 10_000n,
    rounding,
  );
}

export function prorateScaled(
  scaled: bigint,
  covered: bigint,
  total: bigint,
  rounding: RoundingMode = "half_up",
): bigint {
  if (covered < 0n || total <= 0n || covered > total)
    throw new Error("Invalid proration interval");
  return divideRound(scaled * covered, total, rounding);
}

export { QUANTITY_SCALE };
