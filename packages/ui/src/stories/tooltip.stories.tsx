import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button, InfoTip, StatTile, Tooltip } from "../index";

function TooltipGallery() {
  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 620, padding: 24 }}>
      <p style={{ color: "var(--cw-muted)", margin: 0 }}>
        A tooltip opens on hover and on keyboard focus, closes on Escape, and
        opens on the first tap on a touch screen. It carries supporting detail:
        a fact the reader needs to finish the task, and the consequence of a
        destructive action, also belongs in the visible copy of the surface.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Tooltip trigger={<Button variant="secondary">Recalculate</Button>}>
          Prices are re-read from the current price book.
        </Tooltip>
        <Tooltip side="right" trigger={<Button variant="quiet">Export</Button>}>
          Downloads the filtered rows as CSV.
        </Tooltip>
      </div>
      <p style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
        <span>Annual recurring revenue</span>
        <InfoTip label="About annual recurring revenue">
          Contracted subscription value over twelve months. One-time fees and
          usage overage are excluded.
        </InfoTip>
      </p>
      <StatTile
        label={
          <>
            Committed capacity{" "}
            <InfoTip label="About committed capacity">
              The floor each agreement commits to for the current term. Burst
              usage above the floor bills separately.
            </InfoTip>
          </>
        }
        value="820 TB"
        detail="Across four agreements"
      />
    </div>
  );
}

const meta = {
  title: "Foundation/Tooltip",
  component: TooltipGallery,
  tags: ["autodocs"],
} satisfies Meta<typeof TooltipGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Triggers: Story = {};

export const OpenTooltip: Story = {
  render: () => (
    <div style={{ padding: 96 }}>
      <Tooltip defaultOpen side="bottom" trigger={<Button>Send quote</Button>}>
        The customer receives a signing link at the billing contact address.
      </Tooltip>
    </div>
  ),
};

export const OpenInfoTip: Story = {
  render: () => (
    <div style={{ padding: 96 }}>
      <InfoTip defaultOpen side="bottom" label="About the notice window">
        The days before renewal in which either party can give notice.
      </InfoTip>
    </div>
  ),
};
