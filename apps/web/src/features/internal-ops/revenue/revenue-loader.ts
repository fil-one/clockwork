import "server-only";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import { demoRevenueWorkspace } from "./demo-revenue-workspace";
import type { RevenueWorkspace } from "./model";
import {
  readRevenueWorkspace,
  unreadableRevenueWorkspace,
} from "./revenue-repository";

export async function loadRevenueWorkspace(input: {
  requestId: string;
}): Promise<RevenueWorkspace> {
  const database = getOptionalServiceDatabase();
  if (!database)
    return demoDeployIdentityEnabled(process.env)
      ? demoRevenueWorkspace
      : unreadableRevenueWorkspace;
  try {
    return await readRevenueWorkspace(database, input);
  } catch (error) {
    console.error("Revenue workspace could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return unreadableRevenueWorkspace;
  }
}
