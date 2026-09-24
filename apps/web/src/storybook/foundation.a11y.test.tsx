import { render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  Button,
  Dialog,
  EmptyState,
  ErrorBoundary,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TermBar,
  Toast,
  ToastProvider,
  KitTextProvider,
} from "@clockwork/ui";

import { kitText, termBarMessages } from "@/src/features/shared/ui-kit-labels";
import { translatorFor } from "@/src/i18n/catalogs";

const t = translatorFor("en");

function BrokenFixture(): ReactNode {
  throw new Error("Axe error-boundary fixture");
}

describe("foundation Storybook accessibility", () => {
  it("has no axe violations in the composed primitive story", async () => {
    const { container } = render(
      <KitTextProvider text={kitText(t)}>
        <main>
          <Input label="Purchase order" help="Appears on the invoice" />
          <Input label="Purchase order" help="Repeated labels remain unique" />
          <Select
            label="Currency"
            help="Invoice currency"
            options={[{ value: "USD", label: "US dollar" }]}
          />
          <Button>Continue</Button>
          <StatusBadge tone="success">Active</StatusBadge>
          <TermBar
            label="Service term"
            start={new Date("2026-01-01T00:00:00Z")}
            end={new Date("2026-12-31T00:00:00Z")}
            now={new Date("2026-07-31T16:00:00Z")}
            locale="en-US"
            timeZone="UTC"
            messages={termBarMessages(t)}
          />
          <Table
            caption="Orders"
            headers={["Order", "Status"]}
            rows={[["PO-001", "Active"]]}
          />
          <EmptyState
            title="No exceptions"
            description="Nothing needs attention."
          />
          <Skeleton label="Loading agreements" />
          <Dialog
            defaultOpen
            title="Confirm action"
            description="This action will be audited."
            trigger={<Button>Open dialog</Button>}
          >
            <p>Review the action.</p>
          </Dialog>
          <ToastProvider>
            <Toast
              open
              onOpenChange={() => undefined}
              title="Saved"
              description="The quote was saved."
            />
          </ToastProvider>
          <ErrorBoundary
            messages={{
              title: "Something went wrong",
              description: "Quote the request ID when you contact support.",
              retry: "Try again",
            }}
          >
            <BrokenFixture />
          </ErrorBoundary>
        </main>
      </KitTextProvider>,
    );
    expect(container.querySelectorAll("input")[0]?.id).not.toBe(
      container.querySelectorAll("input")[1]?.id,
    );
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });
});
