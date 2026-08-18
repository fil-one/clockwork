import { describe, expect, it, vi, beforeEach } from "vitest";

const deleted: string[] = [];
const redirected: string[] = [];

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: (name: string) => {
        deleted.push(name);
      },
    }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirected.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

const signOutProvider = vi.fn<(options: { returnTo: string }) => void>();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  signOut: (options: { returnTo: string }) => {
    signOutProvider(options);
  },
}));

const getCommerceSession =
  vi.fn<() => Promise<{ authenticationSource: string }>>();
vi.mock("@/src/auth/session", () => ({
  assistedSessionCookieName: "clockwork-assisted-session",
  getCommerceSession: async () => getCommerceSession(),
}));

const { signOutCommerceSession } = await import("@/src/auth/sign-out");

async function runSignOut(): Promise<void> {
  // The action always ends in a redirect, which throws by contract.
  await expect(signOutCommerceSession()).rejects.toThrow("NEXT_REDIRECT");
}

describe("signOutCommerceSession", () => {
  beforeEach(() => {
    deleted.length = 0;
    redirected.length = 0;
    signOutProvider.mockClear();
    getCommerceSession.mockReset();
    getCommerceSession.mockResolvedValue({ authenticationSource: "local" });
  });

  it("clears the demo persona so the home route does not restore it", async () => {
    await runSignOut();

    // Without this the demo home route reads the surviving cookie and sends the
    // browser straight back into the persona the presenter just left.
    expect(deleted).toContain("clockwork-demo-persona");
    expect(redirected).toEqual(["/"]);
  });

  it("clears every session cookie regardless of authentication source", async () => {
    await runSignOut();

    expect(deleted).toEqual(
      expect.arrayContaining([
        "clockwork-assisted-session",
        "clockwork-demo-persona",
        "__Host-clockwork-proof",
      ]),
    );
  });

  it("ends the provider session only for a provider-backed sign-in", async () => {
    getCommerceSession.mockResolvedValue({ authenticationSource: "workos" });
    await runSignOut();
    expect(signOutProvider).toHaveBeenCalledWith({ returnTo: "/" });

    signOutProvider.mockClear();
    getCommerceSession.mockResolvedValue({ authenticationSource: "local" });
    await runSignOut();
    expect(signOutProvider).not.toHaveBeenCalled();
  });

  it("still clears cookies when the session cannot be read", async () => {
    getCommerceSession.mockRejectedValue(new Error("expired"));
    await runSignOut();
    expect(deleted).toContain("clockwork-demo-persona");
  });
});
