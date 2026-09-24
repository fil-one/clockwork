import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import {
  AppShell,
  Button,
  CollectionToolbar,
  CommandPalette,
  EntityCombobox,
  FileText,
  InlineNotice,
  LayoutDashboard,
  ResponsiveRecord,
  ReviewSummary,
  StatusBadge,
  WorkflowStepper,
  KitTextProvider,
} from "@clockwork/ui";

import {
  commandPaletteLabels,
  kitText,
} from "@/src/features/shared/ui-kit-labels";
import { translatorFor } from "@/src/i18n/catalogs";

const t = translatorFor("en");

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
      },
    ],
  },
] as const;

describe("design shell Storybook accessibility", () => {
  it("has no axe violations in the responsive shell and workflow primitives", async () => {
    render(
      <KitTextProvider text={kitText(t)}>
        <AppShell
          navigation={navigation}
          brand="Fil One Commerce"
          bannerLabel={t("platform.shell.banner")}
          skipLabel={t("app.skip")}
          navigationLabel={t("app.nav.primary")}
          mobileNavigationLabel={t("app.nav.open")}
          mobileNavigationTitle={t("app.nav.title")}
          mobileNavigationDescription={t("app.nav.description")}
          mobileNavigationCloseLabel={t("app.nav.close")}
          organization={
            <EntityCombobox
              label="Organization"
              defaultValue="northstar"
              options={[
                { id: "northstar", label: "Northstar Archive Labs" },
                { id: "meridian", label: "Meridian Channel Group" },
              ]}
            />
          }
          utilities={<Button aria-label="Notifications">Notifications</Button>}
          banner={
            <InlineNotice
              tone="warning"
              title="Demo workspace"
              description="Changes remain local to this session."
              action={<Button variant="secondary">Review details</Button>}
            />
          }
          footer="Commerce records are synchronized from the operating ledger."
        >
          <div style={{ display: "grid", gap: 24 }}>
            <header>
              <h1>Agreements</h1>
              <p>Review active commercial terms.</p>
            </header>
            <CollectionToolbar
              label="Agreement controls"
              searchLabel="Search agreements"
              searchPlaceholder="Search"
              loadingLabel="Updating results"
              resultLabel={(count) => t("common.results", { count })}
              resultCount={1}
              filters={<Button variant="secondary">Status</Button>}
              actions={<Button>New agreement</Button>}
            />
            <WorkflowStepper
              label="Agreement workflow"
              steps={[
                { id: "details", label: "Details", state: "complete" },
                { id: "terms", label: "Terms", state: "current" },
                { id: "review", label: "Review", state: "upcoming" },
              ]}
            />
            <ReviewSummary
              title="Agreement review"
              description="One section needs attention."
              items={[
                {
                  id: "account",
                  label: "Account",
                  value: "Northstar Archive Labs",
                },
                {
                  id: "capacity",
                  label: "Capacity",
                  value: "Not set",
                  status: "partial",
                  statusLabel: "Required before submission",
                },
              ]}
            />
            <ResponsiveRecord
              title="Northstar enterprise agreement"
              href="#northstar"
              description="Renews October 31, 2026"
              status={<StatusBadge tone="warning">In notice</StatusBadge>}
              fields={[
                {
                  id: "arr",
                  label: "Annual value",
                  value: "$1,240,000",
                  numeric: true,
                },
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
      </KitTextProvider>,
    );

    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("has no axe violations in the open command no-match state", async () => {
    render(
      <main>
        <h1>Command palette accessibility fixture</h1>
        <CommandPalette
          items={[]}
          defaultOpen
          triggerLabel={t("app.command")}
          {...commandPaletteLabels(t)}
        />
      </main>,
    );

    expect((await axe.run(document.body)).violations).toEqual([]);
  });
});
