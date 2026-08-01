import { describe, expect, it } from "vitest";

import { createUuidV7Generator, isUuidV7, uuidV7Timestamp } from "./uuid-v7";

describe("UUIDv7", () => {
  it("emits RFC 9562 version and variant bits with the source timestamp", () => {
    const timestamp = 1_785_584_400_123;
    const generate = createUuidV7Generator({
      now: () => timestamp,
      randomize: (target) => target.fill(0xab),
    });
    const value = generate();
    expect(isUuidV7(value)).toBe(true);
    expect(uuidV7Timestamp(value)).toBe(timestamp);
  });

  it("matches a fixed RFC field-layout vector", () => {
    const generate = createUuidV7Generator({
      now: () => Number(0x01_23_45_67_89_abn),
      randomize: (target) =>
        target.set([
          0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
        ]),
    });
    expect(generate()).toBe("01234567-89ab-7004-8203-040506070809");
  });

  it("is strictly lexically monotonic within a millisecond and on clock rollback", () => {
    let timestamp = 1_785_584_400_123;
    const generate = createUuidV7Generator({
      now: () => timestamp,
      randomize: (target) => target.fill(0),
    });
    const values = [generate(), generate()];
    timestamp -= 10;
    values.push(generate());
    timestamp += 20;
    values.push(generate());
    expect(values).toEqual([...values].sort());
    expect(new Set(values).size).toBe(values.length);
  });

  it("advances the timestamp when the monotonic random field overflows", () => {
    const generate = createUuidV7Generator({
      now: () => 100,
      randomize: (target) => target.fill(0xff),
    });
    const lastAtTick = generate();
    const firstAtNextTick = generate();
    expect(lastAtTick < firstAtNextTick).toBe(true);
    expect(uuidV7Timestamp(lastAtTick)).toBe(100);
    expect(uuidV7Timestamp(firstAtNextTick)).toBe(101);
  });
});
