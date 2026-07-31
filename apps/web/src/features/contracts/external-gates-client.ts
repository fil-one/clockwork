import { createClockworkClient } from "@clockwork/api/client";

export async function readGeneratedExternalGates(
  baseUrl: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const client = createClockworkClient(baseUrl, fetchImplementation);
  const response = await client.GET("/v1/system/external-gates");
  if (response.error || !response.data)
    throw new Error("External-gate register unavailable");
  return response.data.items;
}

export type GeneratedExternalGate = Awaited<
  ReturnType<typeof readGeneratedExternalGates>
>[number];
