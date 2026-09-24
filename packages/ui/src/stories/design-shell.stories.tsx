import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  BadgeDollarSign,
  Bell,
  Building2,
  Button,
  CollectionToolbar,
  CommandPalette,
  EntityCombobox,
  FileText,
  InlineNotice,
  LayoutDashboard,
  ResponsiveNavigationDrawer,
  ResponsiveRecord,
  ReviewSummary,
  StatusBadge,
  WorkflowStepper,
  AppShell,
  ApplicationStatePanel,
  KitTextProvider,
} from "../index";
import {
  fixtureCommandPaletteLabels,
  fixtureDrawerLabels,
  fixtureKitText,
  fixtureShellLabels,
  fixtureToolbarLabels,
} from "./fixture-labels";

const navigation = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      {
        id: "overview",
        label: "Overview",
        href: "#overview",
        icon: <LayoutDashboard />,
        active: true,
      },
      {
        id: "agreements",
        label: "Agreements",
        href: "#agreements",
        icon: <FileText />,
        badge: <StatusBadge tone="warning">3</StatusBadge>,
      },
      {
        id: "billing",
        label: "Billing",
        href: "#billing",
        icon: <BadgeDollarSign />,
      },
    ],
  },
] as const;

const commands = [
  {
    id: "overview",
    label: "Go to overview",
    description: "Workspace summary",
    category: "navigation",
    audiences: ["customer", "internal"],
    href: "#overview",
    icon: <LayoutDashboard />,
  },
  {
    id: "new-quote",
    label: "Create quote",
    description: "Start from the current price book",
    category: "actions",
    audiences: ["customer", "partner", "internal"],
    href: "#new-quote",
  },
  {
    id: "northstar",
    label: "Northstar Archive Labs",
    description: "Customer · renewal in 92 days",
    category: "records",
    audiences: ["internal"],
    href: "#northstar",
    icon: <Building2 />,
  },
] as const;

function ShellDemo() {
  return (
    <AppShell
      brand="Fil One"
      {...fixtureShellLabels}
      navigation={navigation}
      organization={
        <EntityCombobox
          label={<span className="cw-sr-only">Organization</span>}
          defaultValue="northstar"
          options={[
            { id: "northstar", label: "Northstar Archive Labs" },
            { id: "meridian", label: "Meridian Research Group" },
          ]}
        />
      }
      utilities={
        <>
          <CommandPalette
            triggerLabel="Search and commands"
            {...fixtureCommandPaletteLabels}
            items={commands}
            audience="internal"
          />
          <Button
            variant="quiet"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell aria-hidden="true" />
          </Button>
        </>
      }
      banner={
        <InlineNotice
          tone="warning"
          title="Demo workspace"
          description="Changes are local to this session."
        />
      }
    >
      <div style={{ display: "grid", gap: 20 }}>
        <header>
          <p className="cw-eyebrow">Portfolio</p>
          <h1 style={{ fontFamily: "var(--cw-font-display)", marginBlock: 4 }}>
            Agreements at a glance
          </h1>
          <p style={{ color: "var(--cw-muted)", margin: 0 }}>
            Review terms, capacity, and next actions without losing context.
          </p>
        </header>
        <CollectionToolbar
          {...fixtureToolbarLabels}
          resultCount={2}
          filters={<Button variant="secondary">Status</Button>}
          actions={<Button>New agreement</Button>}
        />
        <ResponsiveRecord
          title="Northstar enterprise agreement"
          href="#northstar"
          eyebrow="Direct customer"
          description="Renews October 31, 2026"
          status={<StatusBadge tone="warning">In notice</StatusBadge>}
          fields={[
            { id: "arr", label: "ARR", value: "$1,240,000", numeric: true },
            {
              id: "capacity",
              label: "Capacity",
              value: "820 TB",
              numeric: true,
            },
          ]}
        />
      </div>
    </AppShell>
  );
}

/** The kit has no default words; the stories supply English ones. */
const withKitText: Decorator = (Story) => (
  <KitTextProvider text={fixtureKitText}>
    <Story />
  </KitTextProvider>
);

const meta = {
  decorators: [withKitText],
  title: "Design shell/Responsive system",
  component: ShellDemo,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShellDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopShell: Story = {};

export const MobileShell: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
  },
};

export const MobileDrawer: Story = {
  render: () => (
    <div style={{ minHeight: "30rem", padding: 16 }}>
      <ResponsiveNavigationDrawer
        {...fixtureDrawerLabels}
        groups={navigation}
        defaultOpen
      />
    </div>
  ),
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const Loading: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, padding: 24 }}>
      <CollectionToolbar {...fixtureToolbarLabels} loading resultCount={3} />
      <ResponsiveRecord title="Loading agreement" loading />
      <ResponsiveRecord title="Loading agreement" loading />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      <ApplicationStatePanel
        state="empty"
        title="No agreements yet"
        description="Create an agreement to begin tracking commercial terms."
        action={<Button>New agreement</Button>}
      />
    </div>
  ),
};

export const NoMatch: Story = {
  render: () => (
    <CommandPalette
      triggerLabel="Search and commands"
      {...fixtureCommandPaletteLabels}
      items={[]}
      defaultOpen
    />
  ),
};

export const Partial: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 24, padding: 24 }}>
      <WorkflowStepper
        label="Quote workflow"
        steps={[
          { id: "details", label: "Details", state: "complete" },
          { id: "terms", label: "Terms", state: "current" },
          { id: "review", label: "Review", state: "upcoming" },
        ]}
      />
      <ReviewSummary
        title="Quote review"
        description="Two sections still need attention."
        items={[
          { id: "account", label: "Account", value: "Northstar Archive Labs" },
          {
            id: "capacity",
            label: "Capacity",
            value: "Not set",
            status: "partial",
            statusLabel: "Required before submission",
          },
        ]}
      />
    </div>
  ),
};

export const Error: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 20, maxWidth: 560, padding: 24 }}>
      <InlineNotice
        tone="danger"
        title="Price book unavailable"
        description="Try again before sending the quote."
        action={<Button variant="secondary">Retry</Button>}
      />
      <EntityCombobox
        label="Bill-to account"
        options={[]}
        error="Select an active billing account."
      />
    </div>
  ),
};

export const KeyboardFocus: Story = {
  render: () => (
    <CommandPalette
      triggerLabel="Search and commands"
      {...fixtureCommandPaletteLabels}
      items={commands}
      audience="internal"
      defaultOpen
    />
  ),
};
