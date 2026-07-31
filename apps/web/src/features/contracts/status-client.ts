import { createClockworkClient } from "@clockwork/api/client";

export type LaneStatus = Readonly<{
  lane: "core" | "lifecycle" | "system";
  status: "ready";
}>;

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
    throw new Error(`Lane status unavailable: ${lane}`);
  return response.data;
}
