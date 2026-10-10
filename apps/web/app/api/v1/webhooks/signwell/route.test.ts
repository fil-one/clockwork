import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mndaByProvider: vi.fn(),
  mndaSync: vi.fn(),
  contractByProvider: vi.fn(),
  contractReplaced: vi.fn(),
  contractSync: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/mnda/server", () => ({
  mndaRepository: () => ({ byProvider: mocks.mndaByProvider }),
  mndaWorkflow: () => ({ sync: mocks.mndaSync }),
}));
vi.mock("@/src/features/internal-ops/contracts/server", () => ({
  contractSigningRepository: () => ({
    byProvider: mocks.contractByProvider,
    replacedByProvider: mocks.contractReplaced,
  }),
  contractSigningWorkflow: () => ({ sync: mocks.contractSync }),
}));
import { POST } from "./route";

const secret = "webhook-secret";
const mndaDocument = "019a44ac-0000-7000-8000-0000000000d1";
const contractDocument = "019a44ac-0000-7000-8000-0000000000d2";

function wakeup(id: string, key = secret) {
  const time = Math.floor(Date.now() / 1000);
  const type = "document_completed";
  return JSON.stringify({
    event: {
      type,
      time,
      hash: createHmac("sha256", key).update(`${type}@${time}`).digest("hex"),
    },
    data: { object: { id } },
  });
}
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://commerce.fil.one/api/v1/webhooks/signwell", {
      method: "POST",
      body,
      headers,
      duplex: "half",
    } as RequestInit),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SIGNWELL_WEBHOOK_ID", secret);
  mocks.mndaByProvider.mockImplementation((id: string) =>
    Promise.resolve(id === mndaDocument ? { id: "mnda-record" } : null),
  );
  mocks.contractByProvider.mockImplementation((id: string) =>
    Promise.resolve(
      id === contractDocument ? { contractId: "contract-record" } : null,
    ),
  );
});

describe("SignWell webhook", () => {
  it("syncs an MNDA without looking up contracts", async () => {
    const response = await post(wakeup(mndaDocument));
    expect(response.status).toBe(200);
    expect(mocks.mndaSync).toHaveBeenCalledWith("mnda-record", {
      kind: "provider",
      id: "signwell",
    });
    expect(mocks.contractByProvider).not.toHaveBeenCalled();
  });

  it("falls through to contracts for a document the MNDA register does not know", async () => {
    const response = await post(wakeup(contractDocument));
    expect(response.status).toBe(200);
    expect(mocks.contractSync).toHaveBeenCalledWith("contract-record", {
      kind: "provider",
      id: "signwell",
    });
    expect(mocks.mndaSync).not.toHaveBeenCalled();
  });

  it("names a late callback for a replaced request in the log, changing nothing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const replacedDocument = "019a44ac-0000-7000-8000-0000000000d3";
    mocks.contractReplaced.mockImplementation((id: string) =>
      Promise.resolve(
        id === replacedDocument
          ? { contractId: "contract-record", requestNumber: 1 }
          : null,
      ),
    );
    expect((await post(wakeup(replacedDocument))).status).toBe(200);
    expect(mocks.contractSync).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "CONTRACT wakeup for a replaced signing request",
      { contractId: "contract-record", requestNumber: 1 },
    );
    info.mockRestore();
  });

  it("answers 503 when the contract lookup fails, and keeps serving MNDAs", async () => {
    mocks.contractByProvider.mockRejectedValue(new Error("database down"));
    expect((await post(wakeup(contractDocument))).status).toBe(503);
    expect((await post(wakeup(mndaDocument))).status).toBe(200);
    expect(mocks.mndaSync).toHaveBeenCalledOnce();
  });

  it("refuses a bad signature before reading any record", async () => {
    const response = await post(wakeup(mndaDocument, "someone-else"));
    expect(response.status).toBe(401);
    expect(mocks.mndaByProvider).not.toHaveBeenCalled();
    expect(mocks.contractByProvider).not.toHaveBeenCalled();
  });

  it.each([
    ["no", {}],
    ["an understated", { "content-length": "10" }],
  ])(
    "stops a streamed oversize body with %s Content-Length",
    async (_label, headers) => {
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 65_536;
          if (sent > 1_048_576) controller.close();
          else controller.enqueue(new Uint8Array(65_536).fill(32));
        },
      });
      const response = await post(stream, headers);
      expect(response.status).toBe(413);
      expect(sent).toBeLessThan(1_048_576);
      expect(mocks.mndaByProvider).not.toHaveBeenCalled();
    },
  );
});
