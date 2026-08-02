import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import {
  Button,
  IconButton,
  InfoTip,
  Navigation,
  RiskIndicator,
  StatTile,
  Tooltip,
} from "@clockwork/ui";

// Radix positions the tooltip with Popper, which observes the trigger. jsdom
// ships no ResizeObserver, so the fixture supplies an inert one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("tooltip Storybook accessibility", () => {
  it("has no axe violations in the open tooltip and info tip", async () => {
    render(
      <main>
        <h1>Tooltip accessibility fixture</h1>
        <Tooltip defaultOpen trigger={<Button>Send quote</Button>}>
          The customer receives a signing link at the billing contact address.
        </Tooltip>
        <StatTile
          label={
            <>
              Committed capacity{" "}
              <InfoTip defaultOpen label="About committed capacity">
                The floor each agreement commits to for the current term.
              </InfoTip>
            </>
          }
          value="820 TB"
          detail="Across four agreements"
        />
      </main>,
    );

    // `region` checks that a whole page keeps its content inside landmarks.
    // Tooltip content is portalled to the body, so a component fixture with no
    // page around it cannot satisfy a page-level rule.
    const result = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it("describes the trigger while open and dismisses on Escape", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <h1>Tooltip keyboard fixture</h1>
        <Tooltip trigger={<Button>Send quote</Button>}>
          The customer receives a signing link.
        </Tooltip>
      </main>,
    );

    const trigger = screen.getByRole("button", { name: "Send quote" });
    await user.tab();
    expect(trigger).toHaveFocus();

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("The customer receives a signing link.");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  // Every converted `title=` site. Radix keeps the element it is given, so a
  // trigger that cannot take focus never shows its tooltip to a keyboard.
  it.each([
    [
      "icon button",
      "Notifications",
      <IconButton label="Notifications" key="icon">
        <span>bell</span>
      </IconButton>,
    ],
    [
      "compact navigation link",
      "Overview",
      <Navigation
        key="nav"
        density="compact"
        groups={[
          {
            id: "workspace",
            items: [{ id: "home", label: "Overview", href: "/" }],
          },
        ]}
      />,
    ],
    [
      "risk indicator with detail",
      "Past due",
      <RiskIndicator
        key="risk"
        level="high"
        label="High risk"
        detail="Past due"
      />,
    ],
  ])("opens the %s tooltip on keyboard focus", async (_name, text, node) => {
    const user = userEvent.setup();
    render(
      <main>
        <h1>Converted trigger fixture</h1>
        {node}
      </main>,
    );

    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(text);
  });

  it("gives the info tip an accessible name and keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <h1>Info tip keyboard fixture</h1>
        <InfoTip label="About committed capacity">
          The floor each agreement commits to for the current term.
        </InfoTip>
      </main>,
    );

    const trigger = screen.getByRole("button", {
      name: "About committed capacity",
    });
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The floor each agreement commits to for the current term.",
    );
  });
});
