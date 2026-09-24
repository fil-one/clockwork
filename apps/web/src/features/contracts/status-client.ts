import { createClockworkClient } from "@clockwork/api/client";

export type LaneStatus = Readonly<
  | {
      lane: "core";
      status: "ready" | "degraded" | "unavailable";
      details: {
        service: "database" | "memory" | "missing";
        stripeWebhook: "configured" | "missing";
      };
    }
  | {
      lane: "lifecycle";
      status: "ready" | "degraded" | "unavailable";
      details: {
        service: "database" | "missing";
        registration: "configured" | "missing";
        esign: "configured" | "missing";
        provisioningWebhook: "configured" | "missing";
        marketplaceWebhook: "configured" | "missing";
        evidenceStorage: "configured" | "missing";
      };
    }
  | {
      lane: "system";
      status: "ready" | "degraded" | "unavailable";
      details: {
        externalGates: "configured" | "missing";
        activationTestRunner: "configured" | "missing";
        workosWebhook: "configured" | "missing";
      };
    }
>;

export async function readGeneratedLaneStatus(
  baseUrl: string,
  lane: LaneStatus["lane"],
  fetchImplementation: typeof fetch = fetch,
): Promise<LaneStatus> {
  const client = createClockworkClient(baseUrl, fetchImplementation);
  const response =
    lane === "core"
      ? await client.GET("/v1/core/status")
      : lane === "lifecycle"
        ? await client.GET("/v1/lifecycle/status")
        : await client.GET("/v1/system/status");
  if (response.error || !response.data)
    // i18n-exempt: caught by Promise.allSettled in status-panel.tsx, which renders its own unavailable state
    throw new Error(`Lane status unavailable: ${lane}`);
  return response.data;
}
