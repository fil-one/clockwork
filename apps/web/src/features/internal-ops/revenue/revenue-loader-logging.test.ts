import { afterEach, describe, expect, it, vi } from "vitest";

import type * as RevenueRepository from "./revenue-repository";

vi.mock("@/src/db/service", () => ({ getOptionalServiceDatabase: () => ({}) }));
vi.mock("./revenue-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof RevenueRepository>()),
  readRevenueWorkspace: () =>
    Promise.reject(
      Object.assign(
        new Error("relation failed for buyer@example.test at 10.0.0.1"),
        { name: "PostgresError", code: "42P01" },
      ),
    ),
}));

const { loadRevenueWorkspace } = await import("./revenue-loader");

afterEach(() => vi.restoreAllMocks());

describe("revenue workspace read failure", () => {
  it("logs the error name only, never its message or stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      loadRevenueWorkspace({ requestId: "revenue-log-shape" }),
    ).resolves.toMatchObject({ readable: false });

    expect(log.mock.calls).toStrictEqual([
      ["Revenue workspace could not be read", { error: "PostgresError" }],
    ]);
  });
});
