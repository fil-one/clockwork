import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { CollectionToolbar, EntityCombobox } from "./collection";
import { CommandPalette } from "./command-palette";
import { ResponsiveRecord } from "./record";
import { AppShell, Navigation } from "./shell";
import { InlineNotice, ReviewSummary, WorkflowStepper } from "./workflow";
import {
  fixtureCommandPaletteLabels,
  fixtureKitText,
  fixtureShellLabels,
  fixtureToolbarLabels,
} from "../stories/fixture-labels";
import { KitTextProvider } from "./kit-text";

describe("design shell public primitives", () => {
  const navigation = [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { id: "home", label: "Overview", href: "/", active: true },
        { id: "orders", label: "Orders", href: "/orders" },
      ],
    },
  ] as const;

  it("keeps navigation current-page semantics in compact mode", () => {
    const html = renderToStaticMarkup(
      <Navigation groups={navigation} label="Primary" density="compact" />,
    );
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-current="page"');
    // The compact rail hides the label and names each link through a tooltip.
    expect(html).toContain('aria-label="Overview"');
    expect(html).toContain('data-state="closed"');
  });

  it("allows an existing page to own the main target", () => {
    const html = renderToStaticMarkup(
      <AppShell
        navigation={navigation}
        brand="Fil One"
        {...fixtureShellLabels}
        contentElement="div"
        contentOwnsTarget={false}
      >
        <main id="main-content">Overview</main>
      </AppShell>,
    );
    expect(html.match(/id="main-content"/gu)).toHaveLength(1);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain("Open navigation");
  });

  it("exposes a named command trigger and audience-aware item contract", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        audience="partner"
        items={[
          {
            id: "new-registration",
            label: "Register opportunity",
            category: "actions",
            audiences: ["partner"],
          },
        ]}
        triggerLabel="Search and commands"
        {...fixtureCommandPaletteLabels}
      />,
    );
    expect(html).toContain('aria-label="Search and commands"');
    expect(html).toContain("⌘K");
  });

  it("renders collection and entity controls with searchable semantics", () => {
    const html = renderToStaticMarkup(
      <KitTextProvider text={fixtureKitText}>
        <CollectionToolbar
          resultCount={2}
          actions={<Button>Add</Button>}
          {...fixtureToolbarLabels}
        />
        <EntityCombobox
          label="Organization"
          defaultValue="northstar"
          options={[{ id: "northstar", label: "Northstar Archive Labs" }]}
        />
      </KitTextProvider>,
    );
    expect(html).toContain('role="search"');
    expect(html).toContain("2 results");
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Northstar Archive Labs");
  });

  it("renders workflow progress, review, notice, and responsive record states", () => {
    const html = renderToStaticMarkup(
      <>
        <WorkflowStepper
          label="Quote workflow"
          steps={[
            { id: "details", label: "Details", state: "complete" },
            { id: "review", label: "Review", state: "current" },
          ]}
        />
        <ReviewSummary
          title="Review quote"
          items={[{ id: "arr", label: "Annual value", value: "$120,000" }]}
        />
        <InlineNotice tone="offline" title="Working offline" />
        <ResponsiveRecord
          title="CW-1042"
          selected
          fields={[
            { id: "arr", label: "ARR", value: "$120,000", numeric: true },
          ]}
        />
      </>,
    );
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("cw-inline-notice--offline");
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-numeric="true"');
  });

  it("refuses to render a picker with no words rather than fall back to English", () => {
    expect(() =>
      renderToStaticMarkup(
        <EntityCombobox label="Organization" options={[]} />,
      ),
    ).toThrow(/KitTextProvider/u);
  });

  it("takes a picker's words from the provider, in the reader's language", () => {
    const html = renderToStaticMarkup(
      <KitTextProvider
        text={{
          close: "Fechar",
          search: "Pesquisar",
          noMatches: "Nenhum resultado",
          loading: "Carregando",
        }}
      >
        <EntityCombobox label="Organização" options={[]} />
      </KitTextProvider>,
    );
    expect(html).toContain('placeholder="Pesquisar"');
    expect(html).not.toContain("Search entities");
  });
});
