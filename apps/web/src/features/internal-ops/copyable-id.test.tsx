import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CopyableId } from "./copyable-id";

describe("CopyableId", () => {
  it("shows the identifier and copies it to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    render(<CopyableId value="ORD-2026-0098" label="Order" />);

    expect(screen.getByText("ORD-2026-0098")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Copy Order ORD-2026-0098" }),
    );

    expect(writeText).toHaveBeenCalledWith("ORD-2026-0098");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "ORD-2026-0098 copied to the clipboard.",
    );
    expect(screen.getByRole("button")).toHaveTextContent("Copied");
  });
});
