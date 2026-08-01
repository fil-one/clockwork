const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANDOM_BITS = 74n;
const RANDOM_MASK = (1n << RANDOM_BITS) - 1n;
const RANDOM_B_MASK = (1n << 62n) - 1n;
const MAX_TIMESTAMP = (1n << 48n) - 1n;

export interface UuidV7GeneratorOptions {
  now?: () => number;
  randomize?: (target: Uint8Array) => void;
}

function secureRandomize(target: Uint8Array): void {
  globalThis.crypto.getRandomValues(target);
}

function randomTail(randomize: (target: Uint8Array) => void): bigint {
  const bytes = new Uint8Array(10);
  randomize(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value & RANDOM_MASK;
}

function renderUuidV7(timestamp: bigint, tail: bigint): string {
  const randA = tail >> 62n;
  const randB = tail & RANDOM_B_MASK;
  const value =
    (timestamp << 80n) | (7n << 76n) | (randA << 64n) | (2n << 62n) | randB;
  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 9562 UUIDv7 generator with monotonic ordering inside one process. */
export function createUuidV7Generator(
  options: UuidV7GeneratorOptions = {},
): () => string {
  const now = options.now ?? Date.now;
  const randomize = options.randomize ?? secureRandomize;
  let lastTimestamp = -1n;
  let lastTail = 0n;

  return () => {
    const observed = BigInt(Math.trunc(now()));
    if (observed < 0n || observed > MAX_TIMESTAMP)
      throw new RangeError("UUIDv7 timestamp is outside its 48-bit range");
    if (observed > lastTimestamp) {
      lastTimestamp = observed;
      lastTail = randomTail(randomize);
    } else {
      lastTail = (lastTail + 1n) & RANDOM_MASK;
      if (lastTail === 0n) {
        if (lastTimestamp === MAX_TIMESTAMP)
          throw new RangeError("UUIDv7 monotonic sequence exhausted");
        lastTimestamp += 1n;
      }
    }
    return renderUuidV7(lastTimestamp, lastTail);
  };
}

const generateUuidV7 = createUuidV7Generator();

export function uuidV7(): string {
  return generateUuidV7();
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function uuidV7Timestamp(value: string): number {
  if (!isUuidV7(value)) throw new TypeError("Value is not an RFC 9562 UUIDv7");
  return Number.parseInt(value.replaceAll("-", "").slice(0, 12), 16);
}
