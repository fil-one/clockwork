import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import { StateGallery, stateGalleryStateKeys } from "./state-gallery";

const t = translatorFor("en");

const headings = [
  "state.loading.title",
  "state.empty.title",
  "state.partial.title",
  "states.optimistic.title",
  "state.success.title",
  "state.validation.title",
  "session.permission.title",
  "state.stale.title",
  "states.offline.title",
  "state.recoverable.title",
  "state.fatal.title",
] as const;

describe("reachable experience state gallery", () => {
  it("renders every normative state exactly once", () => {
    render(<StateGallery />);

    const gallery = screen.getByRole("region", {
      name: t("states.title"),
    });
    expect(stateGalleryStateKeys).toHaveLength(11);
    for (const heading of headings)
      expect(
        within(gallery).getByRole("heading", { name: t(heading) }),
      ).toBeVisible();
  });

  it("preserves live, busy, denial, and failure semantics", () => {
    const { container } = render(<StateGallery />);

    expect(container.querySelector(".cw-state--loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".cw-state--optimistic")).toHaveAttribute(
      "role",
      "status",
    );
    expect(container.querySelector(".cw-state--success")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(container.querySelector(".cw-state--validation")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(container.querySelector(".cw-state--fatal-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(
      screen.getByRole("link", { name: t("session.permission.action") }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
