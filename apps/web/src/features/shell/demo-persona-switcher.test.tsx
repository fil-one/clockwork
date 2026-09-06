import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoPersonaSwitcher } from "./demo-persona-switcher";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("demo reset confirmation", () => {
  it("clears demo state and reloads only after the server reset receipt", async () => {
    const receipt = await resetDemoExperience(createMemoryDemoStore(), {
      environment: { NODE_ENV: "test" },
      target: "demo",
    });
    const reload = vi.fn();
    vi.stubGlobal(
      "window",
      new Proxy(window, {
        get(target, key): unknown {
          return key === "location"
            ? { reload }
            : Reflect.get(target, key, target);
        },
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(receipt)));
    window.localStorage.setItem("clockwork-demo:review", "pending");
    window.localStorage.setItem("unrelated", "retained");
    const user = userEvent.setup();
    render(
      <DemoPersonaSwitcher
        personas={[{ value: "directBuyer", label: "Mara Voss" }]}
        current="directBuyer"
        personaName="Mara Voss"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open demo controls" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore demo data" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reset demo",
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem("clockwork-demo:review")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("retained");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "an authentication page with HTTP 200",
      response: () =>
        new Response("<html>Sign in</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    },
    {
      name: "a followed redirect",
      response: () => {
        const response = Response.json({ target: "demo" });
        Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
    },
    {
      name: "JSON without a reset receipt",
      response: () => Response.json({ ok: true }),
    },
    {
      name: "a non-demo receipt",
      response: () =>
        Response.json({
          target: "production",
          seedVersion: "demo-v1",
          resetAt: "2026-09-06T12:00:00Z",
          statePath: "memory",
          counts: {
            accounts: 9,
            agreements: 1,
            quotes: 1,
            orders: 1,
            pocs: 1,
            invoices: 1,
            queueItems: 1,
          },
        }),
    },
  ])(
    "preserves local state and reports failure for $name",
    async ({ response }) => {
      const fetch = vi.fn().mockResolvedValue(response());
      vi.stubGlobal("fetch", fetch);
      window.localStorage.setItem("clockwork-demo:review", "pending");
      const user = userEvent.setup();
      render(
        <DemoPersonaSwitcher
          personas={[{ value: "directBuyer", label: "Mara Voss" }]}
          current="directBuyer"
          personaName="Mara Voss"
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Open demo controls" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Restore demo data" }),
      );
      const dialog = screen.getByRole("dialog", {
        name: "Reset the demo environment?",
      });
      await user.click(
        within(dialog).getByRole("button", { name: "Reset demo" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The demo data could not be reset.",
      );
      expect(window.localStorage.getItem("clockwork-demo:review")).toBe(
        "pending",
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/demo/reset",
        expect.objectContaining({
          method: "POST",
          cache: "no-store",
          redirect: "error",
        }),
      );
    },
  );
});
