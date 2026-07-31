import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calculateChartGeometry, MetricChart } from "./chart";

describe("calculateChartGeometry", () => {
  it("maps values into a stable SVG coordinate system", () => {
    const geometry = calculateChartGeometry(
      [
        { label: "Jan", value: 10 },
        { label: "Feb", value: 20 },
        { label: "Mar", value: 15 },
      ],
      100,
      50,
    );
    expect(geometry.points).toEqual([
      { x: 0, y: 25 },
      { x: 50, y: 0 },
      { x: 100, y: 12.5 },
    ]);
    expect(geometry.path).toBe("M0,25 L50,0 L100,12.5");
  });

  it("handles empty and constant series without invalid coordinates", () => {
    expect(calculateChartGeometry([], 100, 50)).toEqual({
      points: [],
      path: "",
      min: 0,
      max: 0,
    });
    const constant = calculateChartGeometry(
      [{ label: "Jan", value: 0 }],
      100,
      50,
    );
    expect(constant.path).not.toContain("NaN");
  });
});

describe("MetricChart", () => {
  it("exposes the visual values as an image description and semantic table", () => {
    const html = renderToStaticMarkup(
      <MetricChart
        title="Monthly spend"
        description="Recognized usage"
        data={[
          { label: "June", value: 1200 },
          { label: "July", value: 1400 },
        ]}
        formatValue={(value) => `$${value}`}
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain("Monthly spend. June: $1200, July: $1400");
    expect(html).toContain("<table>");
    expect(html).toContain("$1400");
  });

  it("uses meaningful empty copy instead of an empty graphic", () => {
    const html = renderToStaticMarkup(
      <MetricChart
        title="Capacity"
        data={[]}
        formatValue={String}
        emptyLabel="Capacity is reported after provisioning"
      />,
    );
    expect(html).toContain("Capacity is reported after provisioning");
    expect(html).not.toContain("<svg");
  });
});
