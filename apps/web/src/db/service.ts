import { createRuntimeDatabase } from "@clockwork/db";

let service: ReturnType<typeof createRuntimeDatabase> | undefined;

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
