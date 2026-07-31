import { createRuntimeDatabase } from "@clockwork/db";

let service: ReturnType<typeof createRuntimeDatabase> | undefined;
let runtime: ReturnType<typeof createRuntimeDatabase> | undefined;

export function getRuntimeDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is required for authorized user operations");
  runtime ??= createRuntimeDatabase({ url, role: "clockwork_runtime" });
  return runtime.db;
}

export function getOptionalRuntimeDatabase() {
  return process.env.DATABASE_URL ? getRuntimeDatabase() : undefined;
}

export function getServiceDatabase() {
  const url = process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  if (!url)
    throw new Error(
      "CLOCKWORK_SERVICE_DATABASE_URL is required for service operations",
    );
  service ??= createRuntimeDatabase({ url, role: "clockwork_service" });
  return service.db;
}

export function getOptionalServiceDatabase() {
  return process.env.CLOCKWORK_SERVICE_DATABASE_URL
    ? getServiceDatabase()
    : undefined;
}
