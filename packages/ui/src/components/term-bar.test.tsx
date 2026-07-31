import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountTermRollup, calculateTermProgress, TermBar } from "./term-bar";

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2027-01-01T00:00:00Z");

describe("calculateTermProgress", () => {
  it("clamps dates before and after the term", () => {
    expect(
      calculateTermProgress({
        start,
        end,
        now: new Date("2025-01-01T00:00:00Z"),
      }).elapsedPercent,
    ).toBe(0);
    const completed = calculateTermProgress({
      start,
      end,
      now: new Date("2028-01-01T00:00:00Z"),
    });
    expect(completed.elapsedPercent).toBe(100);
    expect(completed.hasEnded).toBe(true);
    expect(completed.daysRemaining).toBe(0);
  });

  it("identifies a bounded notice window", () => {
    const progress = calculateTermProgress({
      start,
      end,
      now: new Date("2026-10-15T00:00:00Z"),
      noticeStart: new Date("2026-10-01T00:00:00Z"),
      noticeEnd: new Date("2026-11-01T00:00:00Z"),
    });
    expect(progress.isNoticeOpen).toBe(true);
    expect(progress.noticeStartPercent).toBeGreaterThan(70);
    expect(progress.noticeEndPercent).toBeGreaterThan(
      progress.noticeStartPercent ?? 0,
    );
  });

  it("rejects invalid and reversed date ranges", () => {
    expect(() =>
      calculateTermProgress({ start: end, end: start, now: start }),
    ).toThrow("end must be after start");
    expect(() =>
      calculateTermProgress({
        start: new Date("invalid"),
        end,
        now: start,
      }),
    ).toThrow("start must be a valid Date");
  });
});

describe("TermBar", () => {
  it("renders a full screen-reader equivalent and visible notice segment", () => {
    const html = renderToStaticMarkup(
      <TermBar
        label="Annual term"
        start={start}
        end={end}
        now={new Date("2026-07-02T00:00:00Z")}
        noticeStart={new Date("2026-10-01T00:00:00Z")}
        noticeEnd={new Date("2026-11-30T00:00:00Z")}
        renewalState="auto-renews"
      />,
    );
    expect(html).toContain("Annual term");
    expect(html).toContain("Notice window Oct 1, 2026 through Nov 30, 2026");
    expect(html).toContain("Automatic renewal");
    expect(html).toContain("cw-term__notice");
    expect(html).toContain('role="group"');
  });

  it("keeps the legacy noticeDate API and table variant", () => {
    const html = renderToStaticMarkup(
      <TermBar
        label="Legacy term"
        start={start}
        end={end}
        now={start}
        noticeDate={new Date("2026-11-01T00:00:00Z")}
        variant="table"
      />,
    );
    expect(html).toContain("cw-term--table");
    expect(html).toContain("Notice window Nov 1, 2026 through Jan 1, 2027");
  });

  it("supports localized date output and copy overrides", () => {
    const html = renderToStaticMarkup(
      <TermBar
        label="Geschäftsjahr"
        start={start}
        end={end}
        now={start}
        locale="de-DE"
        messages={{
          endDate: (date) => `Endet am ${date}`,
          remaining: (days) => `${days} Tage verbleiben`,
        }}
      />,
    );
    expect(html).toContain("Endet am 01.01.2027");
    expect(html).toContain("365 Tage verbleiben");
  });

  it("rolls account terms up in end-date order", () => {
    const html = renderToStaticMarkup(
      <AccountTermRollup
        label="Account terms"
        now={start}
        terms={[
          {
            id: "later",
            label: "Later term",
            start,
            end: new Date("2027-12-31T00:00:00Z"),
          },
          {
            id: "sooner",
            label: "Sooner term",
            start,
            end,
            renewalState: "notice-open",
          },
        ]}
      />,
    );
    expect(html.indexOf("Sooner term")).toBeLessThan(
      html.indexOf("Later term"),
    );
    expect(html).toContain("2 active terms");
    expect(html).toContain("Next end date");
  });
});
