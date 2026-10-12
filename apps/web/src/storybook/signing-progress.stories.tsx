// i18n-exempt-file: Fictional Storybook fixture labels, never shipped in an application route
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LanguageProvider } from "../i18n/client";
import { catalogs } from "../i18n/catalogs";
import { SigningProgress } from "../features/internal-ops/signing-progress";

const meta: Meta<typeof SigningProgress> = {
  title: "Operations/Signing progress",
  component: SigningProgress,
  decorators: [
    (Story) => (
      <LanguageProvider locale="en" catalog={catalogs.en}>
        <div style={{ maxWidth: 360 }}>
          <Story />
        </div>
      </LanguageProvider>
    ),
  ],
  args: { subject: "Example agreement", prepared: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Preparing: Story = { args: { state: "preparing" } };
export const AwaitingCountersignature: Story = {
  args: { state: "awaiting_countersignature" },
};
export const SingleSigner: Story = {
  args: { state: "sent", counterpartySigns: false },
};
export const Rejected: Story = {
  args: { state: "draft", approval: "rejected" },
};
export const Completed: Story = { args: { state: "completed" } };
