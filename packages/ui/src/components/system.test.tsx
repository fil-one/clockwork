import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import {
  CapacityMeter,
  DocumentCard,
  QueueRow,
  RiskIndicator,
  StatTile,
  Timeline,
} from "./data-display";
import { Checkbox, Input, RadioGroup, Select, Textarea } from "./input";
import { AppShell, Navigation } from "./shell";
import {
  ApplicationStatePanel,
  ProgressSteps,
  Skeleton,
  StateBanner,
  ValidationSummary,
} from "./states";
import { Table } from "./table";
import {
  fixtureDocumentMetaLabels,
  fixtureShellLabels,
} from "../stories/fixture-labels";

describe("form controls", () => {
  it("associates unique labels, help, and validation errors", () => {
    const html = renderToStaticMarkup(
      <form>
        <Input label="Purchase order" help="Invoice reference" />
        <Input label="Purchase order" error="Required" />
        <Select
          label="Currency"
          options={[{ label: "US dollar", value: "USD" }]}
        />
        <Textarea label="Notes" />
      </form>,
    );
    const ids = [...html.matchAll(/id="(field-[^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Invoice reference");
  });

  it("renders keyboard-native checkbox and radio inputs", () => {
    const html = renderToStaticMarkup(
      <>
        <Checkbox label="Approved" description="Recorded in the timeline" />
        <RadioGroup
          legend="Payment"
          name="payment"
          defaultValue="invoice"
          options={[
            { value: "invoice", label: "Invoice" },
            { value: "card", label: "Card", disabled: true },
          ]}
        />
      </>,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked=""');
    expect(html).toContain('disabled=""');
  });
});

describe("shell and navigation", () => {
  const navigation = [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { id: "home", label: "Overview", href: "/", active: true },
        {
          id: "restricted",
          label: "Administration",
          href: "/admin",
          disabled: true,
        },
      ],
    },
  ] as const;

  it("marks current and disabled routes semantically", () => {
    const html = renderToStaticMarkup(
      <Navigation groups={navigation} label="Primary" />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it("provides skip, header, navigation, main, and footer landmarks", () => {
    const html = renderToStaticMarkup(
      <AppShell
        navigation={navigation}
        brand="Fil One"
        {...fixtureShellLabels}
        footer="Request 123"
      >
        <h1>Overview</h1>
      </AppShell>,
    );
    expect(html).toContain('href="#main-content"');
    expect(html).toContain("<header");
    expect(html).toContain("<nav");
    expect(html).toContain("<main");
    expect(html).toContain("<footer");
  });
});

describe("application states", () => {
  const states = [
    "loading",
    "empty",
    "partial",
    "optimistic",
    "success",
    "validation",
    "permission",
    "stale",
    "offline",
    "recoverable-error",
    "fatal-error",
  ] as const;

  it.each(states)("renders the %s treatment", (state) => {
    const html = renderToStaticMarkup(
      <ApplicationStatePanel
        state={state}
        title={`${state} title`}
        description={`${state} description`}
      />,
    );
    expect(html).toContain(`cw-state--${state}`);
    expect(html).toContain(`${state} title`);
    if (state === "loading" || state === "optimistic") {
      expect(html).toContain('aria-busy="true"');
    }
  });

  it("supports actionable banners, validation links, skeletons, and steps", () => {
    const html = renderToStaticMarkup(
      <>
        <StateBanner title="Assisted mode" action={<Button>Exit</Button>} />
        <ValidationSummary
          title="Review fields"
          issues={[{ id: "po", label: "Purchase order", href: "#po" }]}
        />
        <Skeleton label="Loading agreements" />
        <ProgressSteps
          label="Order progress"
          steps={[
            { id: "review", label: "Review", state: "complete" },
            { id: "sign", label: "Sign", state: "current" },
          ]}
        />
      </>,
    );
    expect(html).toContain('href="#po"');
    expect(html).toContain("Loading agreements");
    expect(html).toContain('aria-current="step"');
  });
});

describe("data displays", () => {
  it("renders operational components with useful semantic structures", () => {
    const html = renderToStaticMarkup(
      <>
        <StatTile label="ARR" value="$120k" trend="up" change="8%" />
        <RiskIndicator level="high" label="High risk" detail="Past due" />
        <QueueRow
          title="Legal approval"
          description="Customer paper"
          actions={<Button>Review</Button>}
        />
        <DocumentCard
          type="Order form"
          title="Archive expansion"
          documentId="ORD-1"
          metaLabels={fixtureDocumentMetaLabels}
        />
        <Timeline
          label="Account events"
          items={[{ id: "one", title: "Signed", status: "complete" }]}
        />
        <CapacityMeter
          label="Storage"
          value={74}
          max={100}
          valueLabel="74 TB"
        />
      </>,
    );
    expect(html).toContain("<article");
    expect(html).toContain("<ol");
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="74"');
    expect(html).toContain("Past due");
  });

  it("renders numeric and empty tables accessibly", () => {
    const html = renderToStaticMarkup(
      <Table
        caption="Invoices"
        captionDescription="Open balance"
        headers={["Invoice", "Amount"]}
        rows={[]}
        numericColumns={[1]}
        emptyState="No open invoices"
        footer={["Total", "$0"]}
      />,
    );
    expect(html).toContain("<caption>");
    expect(html).toContain('colSpan="2"');
    expect(html).toContain("cw-table__numeric");
    expect(html).toContain("<tfoot>");
  });
});
