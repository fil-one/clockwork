import {
  createApiApp,
  DatabaseIdempotencyStore,
  type IdempotencyStore,
} from "@clockwork/api";
import {
  DatabaseRoleSynchronizationSink,
  DatabaseWebhookDeduplicator,
} from "@clockwork/db";
import { WorkosWebhookVerifier } from "@clockwork/integrations";

import { WorkosNextSessionResolver } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

const serviceDatabase = getOptionalServiceDatabase();
const unavailableProductionStore: IdempotencyStore = {
  claim: () =>
    Promise.reject(new Error("Durable idempotency database is not configured")),
  complete: () =>
    Promise.reject(new Error("Durable idempotency database is not configured")),
};
const idempotencyStore = serviceDatabase
  ? new DatabaseIdempotencyStore(serviceDatabase)
  : process.env.NODE_ENV === "production"
    ? unavailableProductionStore
    : undefined;
const workosWebhook =
  serviceDatabase && process.env.WORKOS_WEBHOOK_SECRET
    ? {
        verifier: new WorkosWebhookVerifier(process.env.WORKOS_WEBHOOK_SECRET),
        deduplicator: new DatabaseWebhookDeduplicator(serviceDatabase),
        roleSink: new DatabaseRoleSynchronizationSink(serviceDatabase),
      }
    : undefined;
const api = createApiApp({
  sessionResolver: new WorkosNextSessionResolver(),
  ...(idempotencyStore ? { idempotencyStore } : {}),
  ...(workosWebhook ? { system: { workosWebhook } } : {}),
});

async function handle(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  return api.fetch(new Request(url, request));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
