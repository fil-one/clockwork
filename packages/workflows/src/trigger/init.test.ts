import { afterEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => vi.fn());
vi.mock("../runtime/trigger-worker-bootstrap", () => ({
  activateTriggerWorkerRuntime: bootstrap,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("Trigger execution initialization", () => {
  it("awaits durable runtime activation in a fresh execution process", async () => {
    let activate!: () => void;
    bootstrap.mockReturnValue(
      new Promise<void>((resolve) => {
        activate = resolve;
      }),
    );
    let loaded = false;
    const loading = import("./init").then(() => {
      loaded = true;
    });
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledOnce());
    expect(loaded).toBe(false);
    activate();
    await loading;
    expect(loaded).toBe(true);
  });

  it("refuses task startup when runtime activation fails", async () => {
    bootstrap.mockRejectedValue(new Error("database unavailable"));
    await expect(import("./init")).rejects.toThrow("database unavailable");
  });
});
