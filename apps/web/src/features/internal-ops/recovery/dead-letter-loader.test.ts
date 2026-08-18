import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServiceDatabase: vi.fn(),
  readDemoDeadLetters: vi.fn(),
}));

vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("../demo-operator-state", () => ({
  readDemoDeadLetters: mocks.readDemoDeadLetters,
}));

import { loadDeadLetterOperations } from "./dead-letter-loader";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.getOptionalServiceDatabase.mockReturnValue(undefined);
  mocks.readDemoDeadLetters.mockResolvedValue([
    { id: "demo-operation", source: "workflow_run" },
  ]);
});

describe("dead-letter loader deployment boundary", () => {
  it("remains unreadable without a database outside the exact demo", async () => {
    await expect(
      loadDeadLetterOperations({ requestId: "dead-letter-unwired" }),
    ).resolves.toMatchObject({ readable: false, operations: [] });
    expect(mocks.readDemoDeadLetters).not.toHaveBeenCalled();
  });

  it("reads the resettable demo ledger only for the exact demo identity", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CLOCKWORK_ENV", "");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "");

    await expect(
      loadDeadLetterOperations({
        requestId: "dead-letter-demo",
        sources: ["workflow_run"],
      }),
    ).resolves.toMatchObject({
      readable: true,
      source: "Demonstration recovery ledger",
      operations: [{ id: "demo-operation", source: "workflow_run" }],
    });
    expect(mocks.readDemoDeadLetters).toHaveBeenCalledWith({
      sources: ["workflow_run"],
    });
  });
});
