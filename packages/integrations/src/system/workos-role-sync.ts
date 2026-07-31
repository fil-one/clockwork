import { z } from "zod";

const RoleEventSchema = z
  .object({
    id: z.string(),
    event: z.enum([
      "organization_membership.created",
      "organization_membership.updated",
      "organization_membership.deleted",
    ]),
    createdAt: z.string(),
    data: z
      .object({
        id: z.string(),
        organizationId: z.string(),
        userId: z.string(),
        status: z.string().optional(),
        role: z.object({ slug: z.string() }).optional(),
        roles: z.array(z.object({ slug: z.string() })).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface RoleSynchronizationSink {
  apply(input: {
    eventId: string;
    action: "upsert" | "delete";
    workosMembershipId: string;
    workosOrganizationId: string;
    workosUserId: string;
    roleSlugs: readonly string[];
    membershipStatus?: string;
    occurredAt: string;
  }): Promise<void>;
}

export async function synchronizeWorkosRoleEvent(
  payload: unknown,
  sink: RoleSynchronizationSink,
) {
  const event = RoleEventSchema.parse(payload);
  await sink.apply({
    eventId: event.id,
    action: event.event.endsWith(".deleted") ? "delete" : "upsert",
    workosMembershipId: event.data.id,
    workosOrganizationId: event.data.organizationId,
    workosUserId: event.data.userId,
    roleSlugs:
      event.data.roles?.map(({ slug }) => slug) ??
      (event.data.role ? [event.data.role.slug] : []),
    ...(event.data.status ? { membershipStatus: event.data.status } : {}),
    occurredAt: event.createdAt,
  });
}
