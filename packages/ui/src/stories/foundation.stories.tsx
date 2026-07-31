import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";

import {
  Button,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TermBar,
  Toast,
  ToastProvider,
  ErrorBoundary,
} from "../index";

function BrokenDemo(): ReactNode {
  throw new Error("Deterministic Storybook error boundary demo");
}

function FoundationGallery() {
  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 780 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button>Primary action</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Destructive</Button>
        <StatusBadge tone="success">Active</StatusBadge>
        <StatusBadge tone="warning">In notice</StatusBadge>
      </div>
      <Input
        label="Purchase order"
        help="Appears on every invoice."
        placeholder="PO-2026-001"
      />
      <Select
        label="Currency"
        options={[
          { value: "USD", label: "USD — US dollar" },
          { value: "EUR", label: "EUR — Euro" },
          { value: "GBP", label: "GBP — Pound sterling" },
        ]}
      />
      <Dialog
        title="Confirm assisted action"
        description="This action is attributed to you and recorded in the account audit trail."
        trigger={<Button variant="secondary">Open dialog</Button>}
      >
        <p>Enter a reason before continuing.</p>
      </Dialog>
      <TermBar
        label="Annual business term"
        start={new Date("2026-01-01T00:00:00Z")}
        noticeDate={new Date("2026-11-01T00:00:00Z")}
        end={new Date("2026-12-31T00:00:00Z")}
        now={new Date("2026-07-31T16:00:00Z")}
      />
      <Table
        caption="Renewal queue"
        headers={["Account", "Term", "Status"]}
        rows={[
          [
            "Northstar Archive Labs",
            "Dec 31, 2026",
            <StatusBadge tone="warning" key="status">
              In notice
            </StatusBadge>,
          ],
        ]}
      />
      <Skeleton height="3rem" label="Loading invoices" />
      <EmptyState
        title="No open invoices"
        description="Invoices will appear here when provisioning is confirmed."
        action={<Button>Create demo invoice</Button>}
      />
      <ToastProvider>
        <Toast
          open
          onOpenChange={() => undefined}
          title="Quote saved"
          description="Revision 3 is ready for review."
        />
      </ToastProvider>
      <ErrorBoundary>
        <p>Error boundary is armed for this gallery.</p>
      </ErrorBoundary>
    </div>
  );
}

const meta = {
  title: "Foundation/Primitives",
  component: FoundationGallery,
  tags: ["autodocs"],
} satisfies Meta<typeof FoundationGallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllPrimitives: Story = {};
export const OpenDialog: Story = {
  render: () => (
    <Dialog
      defaultOpen
      title="Confirm assisted action"
      description="This action is recorded in the account audit trail."
      trigger={<Button>Open</Button>}
    >
      <Input label="Reason" help="Use at least eight characters." />
    </Dialog>
  ),
};
export const ErrorState: Story = {
  render: () => (
    <ErrorBoundary>
      <BrokenDemo />
    </ErrorBoundary>
  ),
};
