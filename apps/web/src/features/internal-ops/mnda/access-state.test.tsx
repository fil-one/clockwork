import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return { getTranslations: () => Promise.resolve(translatorFor("en")) };
});

import { MndaAccessState } from "./access-state";

/** A demo visitor who types the settings address learns the demo cannot
 * change MNDAs, instead of being told to reload in a minute. */
it("explains the demo instead of a temporary outage", async () => {
  render(await MndaAccessState({ code: "demo_unavailable" }));
  expect(
    screen.getByText("The demo does not prepare, send or change MNDAs."),
  ).toBeVisible();
  expect(screen.queryByText(/unavailable right now/u)).toBeNull();
});
