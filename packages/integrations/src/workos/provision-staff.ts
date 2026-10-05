import { z } from "zod";

/** The identity facts provisioning sends to WorkOS. Roles stay in Postgres. */
export interface WorkosStaffPerson {
  email: string;
  name: string;
  title?: string;
}

type Transport = typeof fetch;

function workosRequester(apiKey: string, transport: Transport) {
  return async (
    path: string,
    options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
  ) => {
    const method = options.method ?? (options.body ? "POST" : "GET");
    const response = await transport(`https://api.workos.com/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) throw new Error(`STAFF_WORKOS_HTTP_${response.status}`);
    return response.json() as Promise<unknown>;
  };
}

const membershipSchema = z.object({
  id: z.string().regex(/^om_/),
  user_id: z.string(),
  organization_id: z.string(),
  status: z.enum(["active", "inactive", "pending"]),
});

/** Creates an identity, without claiming email verification or enrolling MFA
 * on another person's behalf. Passwordless authentication is handled by AuthKit.
 * A membership deactivated when the person last left the team is reactivated
 * rather than duplicated; no step sends an invitation email. */
export async function provisionWorkosStaff(
  apiKey: string,
  organizationId: string,
  person: WorkosStaffPerson,
  transport: Transport = fetch,
) {
  if (!apiKey || !/^org_[A-Za-z0-9]+$/.test(organizationId))
    throw new Error("STAFF_WORKOS_CONFIGURATION_REQUIRED");
  const request = workosRequester(apiKey, transport);
  const email = person.email.toLowerCase();
  const userSchema = z.object({
    id: z.string().regex(/^user_/),
    email: z.email(),
    metadata: z.record(z.string(), z.string()).optional(),
  });
  const users = z
    .object({ data: z.array(userSchema) })
    .parse(
      await request(`user_management/users?email=${encodeURIComponent(email)}`),
    ).data;
  if (users.length > 1) throw new Error("STAFF_IDENTITY_AMBIGUOUS");
  const user =
    users[0] ??
    userSchema.parse(
      await request("user_management/users", {
        body: {
          email,
          first_name: person.name,
          email_verified: false,
          ...(person.title ? { metadata: { job_title: person.title } } : {}),
        },
      }),
    );
  if (user.email.toLowerCase() !== email)
    throw new Error("STAFF_IDENTITY_MISMATCH");
  const memberships = z
    .object({ data: z.array(membershipSchema) })
    .parse(
      await request(
        `user_management/organization_memberships?user_id=${encodeURIComponent(user.id)}&organization_id=${encodeURIComponent(organizationId)}`,
      ),
    ).data;
  if (memberships.length > 1) throw new Error("STAFF_MEMBERSHIP_AMBIGUOUS");
  const existing = memberships[0];
  const membership = !existing
    ? membershipSchema.parse(
        await request("user_management/organization_memberships", {
          body: { user_id: user.id, organization_id: organizationId },
        }),
      )
    : existing.status === "inactive"
      ? membershipSchema.parse(
          await request(
            `user_management/organization_memberships/${encodeURIComponent(existing.id)}/reactivate`,
            { method: "PUT" },
          ),
        )
      : existing;
  if (
    membership.user_id !== user.id ||
    membership.organization_id !== organizationId ||
    membership.status !== "active"
  )
    throw new Error("STAFF_MEMBERSHIP_MISMATCH");
  return { workosUserId: user.id, workosMembershipId: membership.id };
}

/**
 * Removes a staff member from the WorkOS staff organization, so they can no
 * longer select it at sign-in. Idempotent: an already inactive membership is
 * left as it is. The commerce membership is the authority for access; this is
 * the identity-provider half of taking it away.
 */
export async function deactivateWorkosStaffMembership(
  apiKey: string,
  input: { organizationId: string; membershipId: string },
  transport: Transport = fetch,
): Promise<"deactivated" | "already_inactive"> {
  if (
    !apiKey ||
    !/^org_[A-Za-z0-9]+$/.test(input.organizationId) ||
    !/^om_[A-Za-z0-9]+$/.test(input.membershipId)
  )
    throw new Error("STAFF_WORKOS_CONFIGURATION_REQUIRED");
  const request = workosRequester(apiKey, transport);
  const path = `user_management/organization_memberships/${encodeURIComponent(input.membershipId)}`;
  const current = membershipSchema.parse(await request(path));
  if (current.organization_id !== input.organizationId)
    throw new Error("STAFF_MEMBERSHIP_MISMATCH");
  if (current.status === "inactive") return "already_inactive";
  const updated = membershipSchema.parse(
    await request(`${path}/deactivate`, { method: "PUT" }),
  );
  if (updated.id !== input.membershipId || updated.status !== "inactive")
    throw new Error("STAFF_MEMBERSHIP_MISMATCH");
  return "deactivated";
}
