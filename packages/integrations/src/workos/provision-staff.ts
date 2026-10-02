import { z } from "zod";
import type { StaffProvisioning } from "@clockwork/contracts";

/** Creates an identity, without claiming email verification or enrolling MFA
 * on another person's behalf. Passwordless authentication is handled by AuthKit. */
export async function provisionWorkosStaff(
  apiKey: string,
  organizationId: string,
  person: StaffProvisioning,
  transport: typeof fetch = fetch,
) {
  if (!apiKey || !/^org_[A-Za-z0-9]+$/.test(organizationId))
    throw new Error("STAFF_WORKOS_CONFIGURATION_REQUIRED");
  const request = async (path: string, body?: unknown) => {
    const response = await transport(`https://api.workos.com/${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`STAFF_WORKOS_HTTP_${response.status}`);
    return response.json() as Promise<unknown>;
  };
  const userSchema = z.object({
    id: z.string().regex(/^user_/),
    email: z.email(),
    metadata: z.record(z.string(), z.string()).optional(),
  });
  const users = z
    .object({ data: z.array(userSchema) })
    .parse(
      await request(
        `user_management/users?email=${encodeURIComponent(person.email)}`,
      ),
    ).data;
  if (users.length > 1) throw new Error("STAFF_IDENTITY_AMBIGUOUS");
  const user =
    users[0] ??
    userSchema.parse(
      await request("user_management/users", {
        email: person.email,
        first_name: person.name,
        email_verified: false,
        metadata: { job_title: person.title },
      }),
    );
  if (user.email.toLowerCase() !== person.email)
    throw new Error("STAFF_IDENTITY_MISMATCH");
  const membershipSchema = z.object({
    id: z.string().regex(/^om_/),
    user_id: z.string(),
    organization_id: z.string(),
    status: z.literal("active"),
  });
  const memberships = z
    .object({ data: z.array(membershipSchema) })
    .parse(
      await request(
        `user_management/organization_memberships?user_id=${encodeURIComponent(user.id)}&organization_id=${encodeURIComponent(organizationId)}`,
      ),
    ).data;
  if (memberships.length > 1) throw new Error("STAFF_MEMBERSHIP_AMBIGUOUS");
  const membership =
    memberships[0] ??
    membershipSchema.parse(
      await request("user_management/organization_memberships", {
        user_id: user.id,
        organization_id: organizationId,
      }),
    );
  if (
    membership.user_id !== user.id ||
    membership.organization_id !== organizationId
  )
    throw new Error("STAFF_MEMBERSHIP_MISMATCH");
  return { workosUserId: user.id, workosMembershipId: membership.id };
}
