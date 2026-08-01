import { describe, expect, it, vi } from "vitest";

import type { RouteSession } from "@/src/features/shell/route-session";

import { loadAssistedAccountOptions } from "./account-options";

const baseSession: RouteSession = {
  roles: ["finance_approver"],
  profile: { name: "Finance reviewer", email: "finance@filone.com" },
  memberships: [],
  selectedAccountId: "10000000-0000-4000-8000-000000000009",
  effectiveAccountId: "10000000-0000-4000-8000-000000000009",
  providerBacked: true,
  authenticationSource: "workos",
};

describe("assisted account selector confidentiality", () => {
  it("does not execute the service query for an internal role without assisted authority", async () => {
    const listAccounts = vi.fn();

    await expect(
      loadAssistedAccountOptions(
        {} as never,
        { session: baseSession, requestId: "selector:denied" },
        listAccounts,
      ),
    ).resolves.toEqual([]);
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("keeps an active session bound to its effective account without listing other customers", async () => {
    const listAccounts = vi.fn();
    const session: RouteSession = {
      ...baseSession,
      roles: ["internal_operator"],
      assistedSession: {
        id: "12000000-0000-4000-8000-000000000001",
        authenticationSessionId: "auth-session-001",
        actualUserId: "20000000-0000-4000-8000-000000000001",
        actualActorName: "Iris Operator",
        actualActorEmail: "iris@filone.com",
        actualRoles: ["internal_operator"],
        targetAccountId: "10000000-0000-4000-8000-000000000001",
        targetAccountName: "Authorized customer",
        reason: "Customer requested help in case CASE-4812",
        startedAt: new Date("2030-07-31T16:00:00.000Z"),
        expiresAt: new Date("2030-07-31T16:15:00.000Z"),
      },
    };

    await expect(
      loadAssistedAccountOptions(
        {} as never,
        { session, requestId: "selector:active" },
        listAccounts,
      ),
    ).resolves.toEqual([
      {
        id: "10000000-0000-4000-8000-000000000001",
        label: "Authorized customer",
      },
    ]);
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("lists accounts only after server roles authorize assisted action", async () => {
    const listAccounts = vi.fn().mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Authorized customer",
      },
    ]);

    await expect(
      loadAssistedAccountOptions(
        {} as never,
        {
          session: { ...baseSession, roles: ["internal_operator"] },
          requestId: "selector:authorized",
        },
        listAccounts,
      ),
    ).resolves.toEqual([
      {
        id: "10000000-0000-4000-8000-000000000001",
        label: "Authorized customer",
      },
    ]);
    expect(listAccounts).toHaveBeenCalledTimes(1);
  });
});
