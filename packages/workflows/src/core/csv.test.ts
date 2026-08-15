import { describe, expect, it } from "vitest";

import { renderCsv } from "./csv";
import type { ReportRow } from "./ports";

// ignoreBOM keeps the leading byte-order mark visible: it is part of what the
// export writes, and it is what makes Excel read the file as UTF-8.
const render = (rows: readonly ReportRow[], columns?: readonly string[]) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    renderCsv(rows, columns).bytes,
  );

/** RFC 4180 doubles an embedded quote; the neutralising prefix precedes it. */
const neutralised = (value: string) => `'${value.replace(/"/g, '""')}`;

describe("report CSV export", () => {
  it("neutralises every formula lead-in a spreadsheet reaches after discarding invisible padding", () => {
    const leadIns = [
      '=HYPERLINK("https://evil.test","click")',
      "@SUM(A1:A9)",
      "-2+3+cmd|' /C calc'!A0",
      " =1+1",
      "   @SUM(A1)",
      "\t=1+1",
      "\r=1+1",
      "\tordinary text",
      "\rordinary text",
      "\u00A0+1+1",
      "\u2002-1+1",
      "\u3000=1+1",
      "\u2028=1+1",
      "\u202F=1+1",
      "\u200B=1+1",
      "\u2060=1+1",
      " \t\u00A0\u200B=1+1",
    ];
    for (const value of leadIns)
      expect(render([{ cell: value }], ["cell"])).toContain(neutralised(value));
  });

  it("leaves signed numeric constants numeric so negative money still sums in the sheet", () => {
    expect(render([{ delta_minor: "-12000" }], ["delta_minor"])).toBe(
      "\uFEFFdelta_minor\r\n-12000\r\n",
    );
    for (const value of ["-0.5", "+12000", "-1.5e-3", "-.25"])
      expect(render([{ cell: value }], ["cell"])).toBe(
        `\uFEFFcell\r\n${value}\r\n`,
      );
  });

  it("round-trips quotes, the delimiter, newlines and padding", () => {
    expect(
      render(
        [
          {
            quote: 'say "hi"',
            delimiter: "Example, LLC",
            newline: "line one\r\nline two",
            padded: "  padded  ",
          },
        ],
        ["quote", "delimiter", "newline", "padded"],
      ),
    ).toBe(
      "\uFEFFquote,delimiter,newline,padded\r\n" +
        '"say ""hi""","Example, LLC","line one\r\nline two","  padded  "\r\n',
    );
  });
});
