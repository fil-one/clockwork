import "server-only";

import { getOptionalServiceDatabase } from "@/src/db/service";

import type { RevenueWorkspace } from "./model";
import {
  readRevenueWorkspace,
  unreadableRevenueWorkspace,
} from "./revenue-repository";

export async function loadRevenueWorkspace(input: {
  requestId: string;
}): Promise<RevenueWorkspace> {
  const database = getOptionalServiceDatabase();
  if (!database) return unreadableRevenueWorkspace;
  try {
    return await readRevenueWorkspace(database, input);
  } catch {
    return unreadableRevenueWorkspace;
  }
}
