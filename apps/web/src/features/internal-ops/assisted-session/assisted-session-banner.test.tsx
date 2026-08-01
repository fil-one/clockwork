import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistedSessionBanner } from "./assisted-session-banner";

describe("AssistedSessionBanner", () => {
  it("identifies the effective account, staff actor, reason, authority, and reviewed exit", () => {
    render(<AssistedSessionBanner />);

    const banner = screen.getByLabelText("Assisted mode active");
    expect(banner).toHaveTextContent("Northstar Archive Labs");
    expect(banner).toHaveTextContent("Morgan Ellis · Internal operator");
    expect(banner).toHaveTextContent("CASE-4812");
    expect(banner).toHaveTextContent(/server session/i);
    expect(screen.getByRole("link", { name: "Review exit" })).toHaveAttribute(
      "href",
      "/internal/assisted?exit=review",
    );
  });
});
