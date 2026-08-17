import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";

import {
  AccountTermRollup,
  AppShell,
  ApplicationStatePanel,
  BrandLogo,
  BrandSlot,
  Breadcrumbs,
  Button,
  CapacityMeter,
  Checkbox,
  DescriptionList,
  DocumentCard,
  Fieldset,
  FormActions,
  Input,
  MetricChart,
  OptimisticStatus,
  PageHeader,
  ProgressSteps,
  QueueRow,
  RadioGroup,
  RiskIndicator,
  Section,
  Select,
  SkeletonGroup,
  StatTile,
  StateBanner,
  StatusBadge,
  Table,
  TermBar,
  Textarea,
  TextWordmark,
  Timeline,
  ValidationSummary,
} from "../index";

const now = new Date("2026-07-31T16:00:00Z");

/** The supplied marks, served from the web app's public directory. */
const brandAsset = {
  wordmarkDark: "/brand/fo-wordmark-dark.png",
  wordmarkLight: "/brand/fo-wordmark-light.png",
  wordmarkMonoDark: "/brand/fo-wordmark-mono-dark.png",
  wordmarkMonoLight: "/brand/fo-wordmark-mono-light.png",
  iconColor: "/brand/fo-icon-color.png",
  iconMonoDark: "/brand/fo-icon-mono-dark.png",
  iconMonoLight: "/brand/fo-icon-mono-light.png",
} as const;

function MarkPanel({
  label,
  inverse = false,
  children,
}: {
  label: string;
  inverse?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="cw-eyebrow">{label}</p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: 72,
          borderRadius: 12,
          background: inverse ? "var(--cw-ink)" : "var(--cw-surface)",
          border: "1px solid var(--cw-border)",
          padding: "0 20px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ExperienceGallery() {
  return (
    <div style={{ display: "grid", gap: 40, maxWidth: 1080 }}>
      <TextWordmark descriptor="Commerce" />
      <StateBanner
        tone="warning"
        title="Assisted mode"
        description="Actions are attributed to an internal operator and recorded in the account timeline."
        action={
          <Button size="small" variant="secondary">
            Exit assisted mode
          </Button>
        }
      />
      <PageHeader
        eyebrow="Agreement clock"
        title="Northstar Archive Labs"
        description="Commercial terms, renewal posture, and the decisions that need attention."
        actions={<Button>Start renewal</Button>}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
        }}
      >
        <StatTile
          label="Annual recurring value"
          value="$284,000"
          change="8.4%"
          trend="up"
          detail="from prior term"
          tone="positive"
        />
        <StatTile
          label="Open balance"
          value="$18,400"
          detail="2 invoices"
          tone="attention"
        />
        <StatTile label="Services in use" value="7" detail="of 9 contracted" />
        <StatTile
          label="Renewal exposure"
          value="$64,000"
          detail="decision due in 23 days"
          tone="critical"
        />
      </div>
      <AccountTermRollup
        label="Account agreement clock"
        now={now}
        terms={[
          {
            id: "core",
            label: "Core platform",
            start: new Date("2026-01-01T00:00:00Z"),
            end: new Date("2026-12-31T00:00:00Z"),
            noticeStart: new Date("2026-10-01T00:00:00Z"),
            renewalState: "auto-renews",
          },
          {
            id: "services",
            label: "Managed migration",
            start: new Date("2026-03-01T00:00:00Z"),
            end: new Date("2026-10-31T00:00:00Z"),
            noticeStart: new Date("2026-07-15T00:00:00Z"),
            noticeEnd: new Date("2026-08-31T00:00:00Z"),
            renewalState: "notice-open",
          },
        ]}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <MetricChart
          title="Storage consumption"
          description="Trailing six months"
          data={[
            { label: "Feb", value: 48 },
            { label: "Mar", value: 53 },
            { label: "Apr", value: 55 },
            { label: "May", value: 61 },
            { label: "Jun", value: 68 },
            { label: "Jul", value: 74 },
          ]}
          formatValue={(value) => `${value} TB`}
        />
        <MetricChart
          title="Monthly spend"
          description="Recognized usage"
          type="bar"
          data={[
            { label: "Apr", value: 31_200 },
            { label: "May", value: 28_900 },
            { label: "Jun", value: 34_100 },
            { label: "Jul", value: 36_400 },
          ]}
          formatValue={(value) =>
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(value)
          }
        />
      </div>
      <CapacityMeter
        label="Committed capacity"
        value={74}
        max={100}
        valueLabel="74 of 100 TB"
        threshold={90}
        thresholdLabel="Review required at 90 TB"
      />
    </div>
  );
}

const meta = {
  title: "Fil One/Experience system",
  component: ExperienceGallery,
  tags: ["autodocs"],
} satisfies Meta<typeof ExperienceGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const BrandMark: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 24,
        maxWidth: 900,
      }}
    >
      <MarkPanel label="Wordmark, colour">
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.wordmarkDark} />}
        />
      </MarkPanel>
      <MarkPanel label="Wordmark, mono dark ink">
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.wordmarkMonoDark} />}
        />
      </MarkPanel>
      <MarkPanel label="Wordmark, colour on ink" inverse>
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.wordmarkLight} />}
        />
      </MarkPanel>
      <MarkPanel label="Wordmark, mono light ink" inverse>
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.wordmarkMonoLight} />}
        />
      </MarkPanel>
      <MarkPanel label="Icon, colour">
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.iconColor} mark="icon" />}
        />
      </MarkPanel>
      <MarkPanel label="Icon, mono dark ink">
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.iconMonoDark} mark="icon" />}
        />
      </MarkPanel>
      <MarkPanel label="Icon, mono light ink" inverse>
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo src={brandAsset.iconMonoLight} mark="icon" />}
        />
      </MarkPanel>
      <MarkPanel label="No asset resolves">
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo descriptor="Commerce" />}
        />
      </MarkPanel>
      <MarkPanel label="No asset resolves, on ink" inverse>
        <BrandSlot
          homeLink="#"
          homeLabel="Fil One home"
          asset={<BrandLogo inverse descriptor="Commerce" />}
        />
      </MarkPanel>
    </div>
  ),
};

export const AuthenticatedShell: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <AppShell
      navigation={[
        {
          id: "workspace",
          label: "Workspace",
          items: [
            { id: "home", label: "Overview", href: "#", active: true },
            { id: "agreements", label: "Agreements", href: "#" },
            { id: "quotes", label: "Quotes", href: "#", badge: "3" },
            { id: "orders", label: "Orders", href: "#" },
          ],
        },
        {
          id: "finance",
          label: "Finance",
          items: [
            { id: "billing", label: "Billing", href: "#" },
            { id: "renewals", label: "Renewals", href: "#" },
          ],
        },
      ]}
      organization={
        <Button size="small" variant="quiet">
          Northstar Archive Labs
        </Button>
      }
      utilities={
        <>
          <Button size="small" variant="quiet">
            Search
          </Button>
          <Button size="small" variant="secondary">
            Jamie K.
          </Button>
        </>
      }
      banner={
        <StateBanner
          tone="info"
          title="Demo workspace"
          description="Changes reset each morning."
        />
      }
      footer="FIL ONE · Request 01J4FGQX · Privacy"
    >
      <Breadcrumbs items={[{ label: "Accounts" }, { label: "Northstar" }]} />
      <PageHeader
        eyebrow="Customer account"
        title="Commercial overview"
        description="A composed shell story at desktop and mobile breakpoints."
        actions={<Button>Build quote</Button>}
      />
      <ExperienceGallery />
    </AppShell>
  ),
};

export const TermBarVariants: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 32, maxWidth: 760 }}>
      <TermBar
        label="Annual business term"
        start={new Date("2026-01-01T00:00:00Z")}
        end={new Date("2026-12-31T00:00:00Z")}
        noticeStart={new Date("2026-10-01T00:00:00Z")}
        noticeEnd={new Date("2026-11-30T00:00:00Z")}
        now={now}
        renewalState="auto-renews"
      />
      <TermBar
        label="Migration services"
        start={new Date("2026-03-01T00:00:00Z")}
        end={new Date("2026-10-31T00:00:00Z")}
        noticeStart={new Date("2026-07-15T00:00:00Z")}
        noticeEnd={new Date("2026-08-31T00:00:00Z")}
        now={now}
        renewalState="notice-open"
        variant="compact"
      />
      <Table
        caption="Term table variant"
        headers={["Service", "Clock", "State"]}
        rows={[
          [
            "Data vault",
            <TermBar
              key="clock"
              label="Data vault"
              start={new Date("2026-01-01T00:00:00Z")}
              end={new Date("2026-12-31T00:00:00Z")}
              now={now}
              variant="table"
            />,
            <StatusBadge tone="success" key="status">
              Active
            </StatusBadge>,
          ],
        ]}
      />
    </div>
  ),
};

export const EveryApplicationState: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      <SkeletonGroup label="Loading invoice history" />
      <ApplicationStatePanel
        state="loading"
        title="Preparing agreement history"
        description="Signed documents are ready; audit evidence is still being organized."
      />
      <ApplicationStatePanel
        state="empty"
        title="No open invoices"
        description="Invoices appear after an order finishes provisioning."
        action={<Button>View orders</Button>}
      />
      <ApplicationStatePanel
        state="partial"
        title="Usage is delayed"
        description="Billing totals are current; two usage feeds are still arriving."
        action={<Button variant="secondary">Review feeds</Button>}
      />
      <ApplicationStatePanel
        state="optimistic"
        title="Saving revision 4"
        description="You can continue editing while the quote is synchronized."
      />
      <ApplicationStatePanel
        state="success"
        title="Agreement signed"
        description="The executed document and audit evidence are available."
      />
      <ApplicationStatePanel
        state="validation"
        title="Review the highlighted terms"
        description="A start date and billing contact are required before approval."
        action={<Button>Review terms</Button>}
      />
      <ApplicationStatePanel
        state="permission"
        title="Finance role required"
        description="A billing administrator can grant access to payment methods."
      />
      <ApplicationStatePanel
        state="stale"
        title="A newer version exists"
        description="Reload revision 6 before changing commercial terms."
        action={<Button>Reload revision</Button>}
      />
      <ApplicationStatePanel
        state="offline"
        title="Working offline"
        description="Draft changes remain in this browser until the connection returns."
      />
      <ApplicationStatePanel
        state="recoverable-error"
        title="Payment check timed out"
        description="No payment was taken. The provider can be checked again."
        action={<Button>Check again</Button>}
      />
      <ApplicationStatePanel
        state="fatal-error"
        title="Quote cannot be recovered"
        description="The source revision was removed. Start from the last approved version."
        details="Reference QTE-1048-R3 · Request 01J4FGQX"
      />
    </div>
  ),
};

export const KeyboardFirstForms: Story = {
  render: () => (
    <form style={{ display: "grid", gap: 20, maxWidth: 620 }}>
      <ValidationSummary
        title="Review two fields"
        issues={[
          { id: "po", label: "Enter a purchase order", href: "#po" },
          {
            id: "country",
            label: "Choose a billing country",
            href: "#country",
          },
        ]}
      />
      <Fieldset
        legend="Procurement details"
        description="These values appear on invoices and order forms."
      >
        <Input
          id="po"
          label="Purchase order"
          help="Use the identifier from your procurement system."
          error="Enter a purchase order."
          placeholder="PO-2026-001"
        />
        <Select
          id="country"
          label="Billing country"
          placeholder="Choose a country"
          options={[
            { value: "US", label: "United States" },
            { value: "GB", label: "United Kingdom" },
            { value: "DE", label: "Germany" },
          ]}
        />
        <Textarea
          label="Invoice instructions"
          optionalLabel="Optional"
          help="Do not include card or bank details."
        />
      </Fieldset>
      <RadioGroup
        legend="Payment method"
        name="payment"
        defaultValue="invoice"
        options={[
          {
            value: "invoice",
            label: "Invoice",
            description: "Net 30 from the invoice date.",
          },
          {
            value: "card",
            label: "Card",
            description: "Charged after provisioning completes.",
          },
        ]}
      />
      <Checkbox
        label="I confirm procurement approval"
        description="This confirmation is recorded in the account timeline."
      />
      <FormActions>
        <Button variant="quiet">Cancel</Button>
        <Button>Continue</Button>
      </FormActions>
    </form>
  ),
};

export const OperationsAndDocuments: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 28, maxWidth: 900 }}>
      <Section
        title="Approval queue"
        description="Oldest decisions appear first."
      >
        <div>
          <QueueRow
            eyebrow="Legal approval"
            title="Northstar customer paper"
            description="4 material variances against the approved MSA."
            risk={<RiskIndicator level="high" label="High risk" />}
            time="Waiting 3 days"
            actions={
              <Button size="small" variant="secondary">
                Review
              </Button>
            }
          />
          <QueueRow
            eyebrow="Finance approval"
            title="Volume discount exception"
            description="Requested discount is 3.5 points above policy."
            risk={<RiskIndicator level="moderate" label="Moderate risk" />}
            time="Waiting 6 hours"
            actions={
              <Button size="small" variant="secondary">
                Review
              </Button>
            }
          />
        </div>
      </Section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <DocumentCard
          type="Order form"
          title="Managed archive expansion"
          documentId="ORD-2026-1842"
          version="v4 · 7bf2d1"
          updated="Jul 30, 2026"
          status={<StatusBadge tone="success">Executed</StatusBadge>}
          summary="Countersigned order for 40 TB of additional managed capacity."
          actions={
            <Button size="small" variant="secondary">
              View PDF
            </Button>
          }
        />
        <DocumentCard
          type="Amendment"
          title="Data residency amendment"
          documentId="AMD-2026-0091"
          version="v2 · 19cc81"
          updated="Jul 28, 2026"
          status={<StatusBadge tone="warning">Awaiting signature</StatusBadge>}
        />
      </div>
      <Timeline
        label="Account events"
        items={[
          {
            id: "signed",
            title: "Order form countersigned",
            description: "Execution evidence and signed PDF were stored.",
            timestamp: "Jul 30 · 4:18 PM",
            status: "complete",
          },
          {
            id: "provisioning",
            title: "Provisioning in progress",
            description: "AWS capacity is ready; support tenant is pending.",
            timestamp: "Jul 31 · 9:06 AM",
            status: "current",
          },
          {
            id: "billing",
            title: "Billing activation",
            description: "Begins when all required services report ready.",
            status: "upcoming",
          },
        ]}
      />
      <DescriptionList
        items={[
          { term: "Agreement owner", detail: "Jamie Liu" },
          { term: "Billing currency", detail: "USD" },
          { term: "Payment terms", detail: "Net 30" },
          { term: "Tax treatment", detail: "US sales tax" },
        ]}
      />
      <ProgressSteps
        label="Signing progress"
        steps={[
          { id: "review", label: "Review", state: "complete" },
          { id: "approve", label: "Approve", state: "complete" },
          {
            id: "sign",
            label: "Sign",
            description: "With customer",
            state: "current",
          },
          { id: "provision", label: "Provision", state: "upcoming" },
        ]}
      />
      <OptimisticStatus
        pending
        pendingLabel="Saving account note"
        settledLabel="Account note saved"
      />
    </div>
  ),
};
