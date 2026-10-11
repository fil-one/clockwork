import { describe, expect, it } from "vitest";

import {
  accessTokenDisplayPrefix,
  generateAccessTokenSecret,
  hashAccessTokenSecret,
  isAccessTokenSecret,
} from "./access-tokens";

describe("access token secrets", () => {
  it("are 256 random bits with a recognisable prefix", () => {
    const secret = generateAccessTokenSecret();
    expect(secret).toMatch(/^fo_pat_[A-Za-z0-9_-]{43}$/u);
    expect(isAccessTokenSecret(secret)).toBe(true);
    expect(generateAccessTokenSecret()).not.toBe(secret);
  });

  it("are stored as a SHA-256 hash, never as themselves", () => {
    const secret = generateAccessTokenSecret();
    const hash = hashAccessTokenSecret(secret);
    expect(hash).toHaveLength(32);
    expect(hash.equals(hashAccessTokenSecret(secret))).toBe(true);
    expect(hash.toString("utf8")).not.toContain(secret.slice(7));
    expect(
      hashAccessTokenSecret(`fo_pat_${"a".repeat(43)}`).toString("hex"),
    ).toBe("d76625c2a2eb6ad003572cb5df1812915284f7648a87815950eb6255818025ba");
  });

  it("show only the prefix and four characters", () => {
    const secret = generateAccessTokenSecret();
    expect(accessTokenDisplayPrefix(secret)).toBe(secret.slice(0, 11));
    expect(accessTokenDisplayPrefix(secret)).toMatch(
      /^fo_pat_[A-Za-z0-9_-]{4}$/u,
    );
  });

  it("refuse anything that is not a secret this server issues", () => {
    for (const value of [
      "",
      "fo_pat_short",
      `fo_pat_${"a".repeat(44)}`,
      `xx_pat_${"a".repeat(43)}`,
      `fo_pat_${"a".repeat(42)}!`,
      `Bearer fo_pat_${"a".repeat(43)}`,
    ])
      expect(isAccessTokenSecret(value), value).toBe(false);
  });
});
