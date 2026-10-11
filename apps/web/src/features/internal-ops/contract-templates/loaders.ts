import "server-only";
import { z } from "zod";
import { getRequestCommerceSession } from "@/src/auth/session";
import { ContractAccessError } from "../contracts/server";
import type { Loaded } from "../contracts/loaders";
import { groupTemplates } from "./model";
import {
  contractTemplateRepository,
  demoTemplateRecords,
  templateAdmin,
} from "./server";

async function loadAdmin<T>(
  load: (demo: boolean) => Promise<T>,
): Promise<Loaded<T & { demo: boolean }>> {
  try {
    const { demo } = await templateAdmin(getRequestCommerceSession);
    return { kind: "ready", demo, ...(await load(demo)) };
  } catch (error) {
    if (error instanceof ContractAccessError)
      return { kind: "denied", code: error.code };
    if (
      error instanceof Error &&
      error.message === "CONTRACT_TEMPLATE_NOT_FOUND"
    )
      return { kind: "missing" };
    console.error("contract templates: page load failed", error);
    return { kind: "error" };
  }
}

export function loadTemplateAdmin() {
  return loadAdmin(async (demo) => ({
    groups: groupTemplates(
      demo ? demoTemplateRecords() : await contractTemplateRepository().list(),
    ),
  }));
}

export function loadTemplateVersion(id: string) {
  return loadAdmin(async (demo) => {
    if (!z.uuid().safeParse(id).success)
      throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    const record = demo
      ? demoTemplateRecords().find((row) => row.id === id)
      : await contractTemplateRepository().get(id);
    if (!record) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    const others = demo
      ? []
      : (await contractTemplateRepository().list()).filter(
          (row) => row.key === record.key && row.id !== record.id,
        );
    return { record, others };
  });
}
