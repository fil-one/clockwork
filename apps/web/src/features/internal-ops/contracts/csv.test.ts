import { expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

it("quotes separators and neutralizes formula-looking text", () => {
  expect(csvCell("Bluefin, Inc.")).toBe('"Bluefin, Inc."');
  expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  expect(csvCell("=1+1")).toBe("'=1+1");
  expect(csvCell("+44 20")).toBe("'+44 20");
  expect(csvCell("-5")).toBe("'-5");
  expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  expect(csvCell(-5)).toBe("-5");
  expect(csvCell(null)).toBe("");
  expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
});

it("starts with a byte-order mark and ends rows with CRLF", () => {
  const csv = toCsv(["A", "B"], [[1, "x"]]);
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.slice(1)).toBe("A,B\r\n1,x\r\n");
});
