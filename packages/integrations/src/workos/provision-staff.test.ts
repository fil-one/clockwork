import { expect, it, vi } from "vitest";
import { provisionWorkosStaff } from "./provision-staff";
const person = {
  email: "rw@fil.one",
  name: "Revenue operator",
  title: "Head of Revenue",
  role: "internal_operator" as const,
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
  ).toEqual({ workosUserId: "user_staff", workosMembershipId: "om_staff" });
  const body = transport.mock.calls[1]?.[1]?.body;
  expect(typeof body === "string" ? JSON.parse(body) : null).toMatchObject({
    email_verified: false,
    metadata: { job_title: "Head of Revenue" },
  });
  expect(transport.mock.calls.map(([url]) => url)).not.toContain(
    expect.stringContaining("invitation"),
  );
});
it("reuses exact existing identity and membership without broadening roles", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "user_staff", email: person.email }] }),
    )
    .mockResolvedValueOnce(Response.json({ data: [member] }));
  await provisionWorkosStaff("private", "org_staff", person, transport);
  expect(
    transport.mock.calls.every(([, options]) => options?.method === "GET"),
  ).toBe(true);
});
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
