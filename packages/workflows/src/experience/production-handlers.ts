import {
  DatabaseAuthoritativePortalCommandExecutor,
  DatabaseAuthoritativeStateLoader,
  DatabasePortalActionPersistence,
  DatabasePortalProjectionMaterializer,
  type RuntimeDatabase,
} from "@clockwork/db";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import { createPortalActionOutboxHandlers } from "./portal-action-handler";
import { createCanonicalPortalProjectionDefinitions } from "./projection-definitions";
import { createProjectionMaterializerOutboxHandlers } from "./projection-materializer";
import type { TaxPort } from "@clockwork/contracts";

export const experienceEvidenceAcknowledgementTopics = [
  "experience.projection_action.applied",
  "experience.projection_action.rejected",
  "experience.projection_action.failed",
  "experience.projection_action.retry_released",
  "experience.projection.materialized",
] as const;

function addHandlers(
  target: Map<string, OutboxTopicHandler>,
  source: ReadonlyMap<string, OutboxTopicHandler>,
) {
  for (const [topic, handler] of source) {
    if (target.has(topic))
      throw new Error(`EXPERIENCE_OUTBOX_TOPIC_DUPLICATE:${topic}`);
    target.set(topic, handler);
  }
}

/**
 * Exact production composition shared by Trigger workers and the
 * production-shaped browser proof. Terminal experience events already have
 * durable audit/outbox evidence; their acknowledgement handlers deliberately
 * mark that evidence consumed so the operational outbox cannot accumulate
 * permanently pending internal-only notification rows.
 */
export function createProductionExperienceOutboxHandlers(input: {
  database: RuntimeDatabase;
  authorizationSecret: string;
  tax: TaxPort;
  clock?: () => Date;
  leaseMs?: number;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const handlers = new Map<string, OutboxTopicHandler>();
  addHandlers(
    handlers,
    createPortalActionOutboxHandlers({
      persistence: new DatabasePortalActionPersistence(
        input.database,
        input.leaseMs,
      ),
      commands: new DatabaseAuthoritativePortalCommandExecutor({
        database: input.database,
        authorizationSecret: input.authorizationSecret,
        tax: input.tax,
        ...(input.clock ? { now: input.clock } : {}),
      }),
      ...(input.clock ? { clock: input.clock } : {}),
    }),
  );
  addHandlers(
    handlers,
    createProjectionMaterializerOutboxHandlers({
      source: new DatabaseAuthoritativeStateLoader(input.database),
      persistence: new DatabasePortalProjectionMaterializer(input.database),
      definitions: createCanonicalPortalProjectionDefinitions(),
      ...(input.clock ? { clock: input.clock } : {}),
    }),
  );
  for (const topic of experienceEvidenceAcknowledgementTopics)
    handlers.set(topic, async () => {});
  return handlers;
}
