import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { coreReportNames } from "@clockwork/contracts";

import { reportNames } from "@/src/features/contracts/commerce-client";

import type { SurfaceProvenance } from "./provenance";
import type { ReportExportRecord } from "./reports-projection";
import { ReportsView } from "./reports-view";

const provenance: SurfaceProvenance = {
  kind: "projection",
  channel: "reports",
  generatedAt: "2026-08-15T09:15:00.000Z",
  stale: false,
  pagesRead: 1,
  recordCount: 3,
};

function exportRecord(
  overrides: Partial<ReportExportRecord> & Pick<ReportExportRecord, "id">,
): ReportExportRecord {
  return {
    aggregateId: `60000000-0000-4000-8000-0000000000${overrides.id.slice(-2)}`,
    report: "revenue_forecast",
    title: `${overrides.id} export`,
    status: "complete",
    statusLabel: "Complete",
    documentId: null,
    evidence: [],
    version: 1,
    updatedAt: "2026-08-15T09:00:00.000Z",
    ...overrides,
  };
}

const exports: readonly ReportExportRecord[] = [
  exportRecord({ id: "RPT-01", report: "revenue_forecast" }),
  exportRecord({ id: "RPT-02", report: "weekly_scorecard" }),
  exportRecord({ id: "RPT-03", report: "revenue_forecast" }),
  exportRecord({ id: "RPT-04", report: null }),
];

function renderView() {
  return render(
    <ReportsView accounts={[]} exports={exports} provenance={provenance} />,
  );
}

function reportFilter() {
  return screen.getByRole("combobox", { name: /^Report/u });
}

function recordedExports() {
  const section = screen
    .getByRole("heading", { name: "Recorded report exports" })
    .closest("section");
  if (!section) throw new Error("Recorded exports section was not rendered.");
  return section;
}

describe("ReportsView report filter", () => {
  it("uses the contract catalogue as the web export registry", () => {
    expect(reportNames).toBe(coreReportNames);
  });

  it("offers every report in the registry plus the unfiltered option", () => {
    renderView();

    const options = within(reportFilter())
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["", ...reportNames]);
  });

  it("offers an export control for every contract report with honest money labels", () => {
    renderView();

    expect(screen.getAllByRole("button", { name: "Export CSV" })).toHaveLength(
      coreReportNames.length,
    );
    for (const heading of [
      "ARR & MRR",
      "Billing & collections",
      "Commission settlement",
    ])
      expect(
        screen.getByRole("heading", { level: 3, name: heading }),
      ).toBeVisible();
  });

  /**
   * The filter is over the projection, not over a fixture: `RPT-01` and
   * `RPT-03` are the two recorded exports whose `report_export` payload names
   * `revenue_forecast`, and they are the two that survive.
   */
  it("narrows the recorded exports to the selected report", async () => {
    const user = userEvent.setup();
    renderView();

    const recorded = recordedExports();
    expect(within(recorded).getByText("4 exports")).toBeVisible();

    await user.selectOptions(reportFilter(), "revenue_forecast");

    expect(within(recorded).getByText("2 exports")).toBeVisible();
    expect(within(recorded).getByText("RPT-01 export")).toBeVisible();
    expect(within(recorded).getByText("RPT-03 export")).toBeVisible();
    expect(within(recorded).queryByText("RPT-02 export")).toBeNull();
    expect(within(recorded).queryByText("RPT-04 export")).toBeNull();
  });

  it("narrows the offered exports to the selected report", async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.getAllByRole("button", { name: "Export CSV" })).toHaveLength(
      reportNames.length,
    );

    await user.selectOptions(reportFilter(), "weekly_scorecard");

    expect(screen.getAllByRole("button", { name: "Export CSV" })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Weekly Scorecard" }),
    ).toBeVisible();
  });

  it("says the filter emptied the table rather than that the scope holds nothing", async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(reportFilter(), "capacity_planning");

    const recorded = recordedExports();
    expect(
      within(recorded).getByText(/No recorded export names/u),
    ).toBeVisible();
    expect(
      within(recorded).queryByText(/projected into your operator scope/u),
    ).toBeNull();
  });

  it("restores every export when the filter is cleared", async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(reportFilter(), "weekly_scorecard");
    await user.selectOptions(reportFilter(), "");

    const recorded = recordedExports();
    expect(within(recorded).getByText("4 exports")).toBeVisible();
    expect(within(recorded).getByText("RPT-04 export")).toBeVisible();
  });
});
