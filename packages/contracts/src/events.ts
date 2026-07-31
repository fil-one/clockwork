import { z } from "zod";

import { entityNames, ids, IsoDateTimeSchema } from "./primitives";

export const ActorSchema = z
  .object({
    kind: z.enum(["user", "system", "provider"]),
    id: z.string().min(1),
    display: z.string().min(1).optional(),
    effectiveUserId: ids.user.optional(),
    impersonatedAccountId: ids.account.optional(),
    assistedActionReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export const EventEnvelopeSchema = z
  .object({
    id: ids.auditEvent,
    specVersion: z.literal("1.0"),
    eventVersion: z.int().positive(),
    type: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    occurredAt: IsoDateTimeSchema,
    requestId: ids.request,
    aggregate: z.object({
      type: z.enum(entityNames),
      id: z.uuid(),
      version: z.int().positive(),
    }),
    actor: ActorSchema,
    data: z.record(z.string(), z.unknown()),
    metadata: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export type Actor = z.infer<typeof ActorSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
