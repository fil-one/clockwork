import { expect, it, vi } from "vitest";
import {
  deactivateWorkosStaffMembership,
  provisionWorkosStaff,
  removeWorkosOrganizationMembership,
} from "./provision-staff";
const person = {
  email: "rw@fil.one",
  name: "Revenue operator",
  title: "Head of Revenue",
};
const member = {
  id: "om_staff",
  user_id: "user_staff",
  organization_id: "org_staff",
  status: "active",
};
it("creates a passwordless identity without asserting email verification or sending invitations", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(
      Response.json({ id: "user_staff", email: person.email }),
    )
    .mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(Response.json(member));
  expect(
    await provisionWorkosStaff("private", "org_staff", person, transport),
  ).toEqual({
    workosUserId: "user_staff",
    workosMembershipId: "om_staff",
    outcome: "created",
  });
  const body = transport.mock.calls[1]?.[1]?.body;
  expect(typeof body === "string" ? JSON.parse(body) : null).toMatchObject({
    email_verified: false,
    metadata: { job_title: "Head of Revenue" },
  });
  expect(transport.mock.calls.map(([url]) => url)).not.toContain(
    expect.stringContaining("invitation"),
  );
});
it("omits the job title when none is given", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(
      Response.json({ id: "user_staff", email: person.email }),
    )
    .mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(Response.json(member));
  await provisionWorkosStaff(
    "private",
    "org_staff",
    { email: "RW@fil.one", name: "R.W." },
    transport,
  );
  const body = transport.mock.calls[1]?.[1]?.body;
  const parsed: unknown = typeof body === "string" ? JSON.parse(body) : null;
  expect(parsed).toMatchObject({ email: "rw@fil.one" });
  expect(parsed).not.toHaveProperty("metadata");
});
it("reuses exact existing identity and membership without broadening roles", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "user_staff", email: person.email }] }),
    )
    .mockResolvedValueOnce(Response.json({ data: [member] }));
  await expect(
    provisionWorkosStaff("private", "org_staff", person, transport),
  ).resolves.toMatchObject({ outcome: "existing" });
  expect(
    transport.mock.calls.every(([, options]) => options?.method === "GET"),
  ).toBe(true);
});
it.each(["active", "inactive", "pending"] as const)(
  "preserves an existing %s membership with WorkOS status filtering",
  async (status) => {
    const transport = vi.fn<typeof fetch>((input, options) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.pathname === "/user_management/users")
        return Promise.resolve(
          Response.json({
            data: [{ id: "user_staff", email: person.email }],
          }),
        );
      if (options?.method === "GET") {
        expect(url.searchParams.get("user_id")).toBe(member.user_id);
        expect(url.searchParams.get("organization_id")).toBe(
          member.organization_id,
        );
        // WorkOS lists only active memberships unless statuses is explicit.
        const statuses = (url.searchParams.get("statuses") ?? "active").split(
          ",",
        );
        return Promise.resolve(
          Response.json({
            data: statuses.includes(status) ? [{ ...member, status }] : [],
          }),
        );
      }
      // Creating an existing inactive membership also activates it, which
      // previously misclassified it as new and made compensation delete it.
      return Promise.resolve(Response.json(member));
    });
    const provisioned = provisionWorkosStaff(
      "private",
      "org_staff",
      person,
      transport,
    );
    if (status === "pending") {
      await expect(provisioned).rejects.toThrow("STAFF_MEMBERSHIP_MISMATCH");
    } else {
      await expect(provisioned).resolves.toEqual({
        workosUserId: "user_staff",
        workosMembershipId: "om_staff",
        outcome: status === "inactive" ? "reactivated" : "existing",
      });
    }
    const writes = transport.mock.calls.filter(
      ([, options]) => options?.method !== "GET",
    );
    if (status === "inactive") {
      expect(writes).toHaveLength(1);
      expect(writes[0]?.[0]).toBe(
        "https://api.workos.com/user_management/organization_memberships/om_staff/reactivate",
      );
      expect(writes[0]?.[1]?.method).toBe("PUT");
    } else expect(writes).toHaveLength(0);
  },
);
it.each([{ user_id: "user_other" }, { organization_id: "org_other" }])(
  "refuses a mismatched inactive membership before reactivation: %j",
  async (mismatch) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "user_staff", email: person.email }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ ...member, status: "inactive", ...mismatch }],
        }),
      )
      .mockResolvedValueOnce(Response.json(member));
    await expect(
      provisionWorkosStaff("private", "org_staff", person, transport),
    ).rejects.toThrow("STAFF_MEMBERSHIP_MISMATCH");
    expect(transport).toHaveBeenCalledTimes(2);
  },
);
it("fails closed on identity/provider errors", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      data: [{ id: "user_wrong", email: "other@example.com" }],
    }),
  );
  await expect(
    provisionWorkosStaff("private", "org_staff", person, transport),
  ).rejects.toThrow("IDENTITY_MISMATCH");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("deactivates an active staff membership in the named organization only", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(member))
    .mockResolvedValueOnce(Response.json({ ...member, status: "inactive" }));
  await expect(
    deactivateWorkosStaffMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).resolves.toBe("deactivated");
  expect(transport.mock.calls[1]?.[0]).toBe(
    "https://api.workos.com/user_management/organization_memberships/om_staff/deactivate",
  );
  expect(transport.mock.calls[1]?.[1]?.method).toBe("PUT");
});
it("leaves an already inactive membership alone", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...member, status: "inactive" }));
  await expect(
    deactivateWorkosStaffMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).resolves.toBe("already_inactive");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("refuses to deactivate a membership of another organization", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ ...member, organization_id: "org_customer" }),
    );
  await expect(
    deactivateWorkosStaffMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).rejects.toThrow("STAFF_MEMBERSHIP_MISMATCH");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("removes a membership of the named organization, and accepts one already gone", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(member))
    .mockResolvedValueOnce(new Response(null, { status: 202 }));
  await expect(
    removeWorkosOrganizationMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).resolves.toBe("removed");
  expect(transport.mock.calls[1]?.[1]?.method).toBe("DELETE");
  const gone = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 404 }));
  await expect(
    removeWorkosOrganizationMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      gone,
    ),
  ).resolves.toBe("already_removed");
});
it("refuses to remove a membership of another organization", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ ...member, organization_id: "org_customer" }),
    );
  await expect(
    removeWorkosOrganizationMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).rejects.toThrow("STAFF_MEMBERSHIP_MISMATCH");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("surfaces provider failures as a status code without the response body", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("secret detail", { status: 503 }));
  await expect(
    deactivateWorkosStaffMembership(
      "private",
      { organizationId: "org_staff", membershipId: "om_staff" },
      transport,
    ),
  ).rejects.toThrow(/^STAFF_WORKOS_HTTP_503$/);
});
