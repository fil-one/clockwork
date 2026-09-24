import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/src/features/experience-server/internal-projection-page", () => ({
  InternalProjectionPage: ({ channel }: { channel: string }) => (
    <p>Canonical channel: {channel}</p>
  ),
}));
import Page from "./page";
it("always reads the canonical approval projection channel", async () => {
  render(await Page());
  expect(screen.getByText("Canonical channel: approvals")).toBeInTheDocument();
});
