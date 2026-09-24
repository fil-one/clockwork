import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { MachineCode } from "./machine-code";

/**
 * In German, French, Spanish and Portuguese the table cells hyphenate, and an
 * identifier set as plain text came out as "invoice.-payment_-failed" or
 * "PROCESSING_ATTEM-PTS_EXHAUSTED". MachineCode marks the value as not
 * language (`translate="no"`, which the stylesheet sets to `hyphens: manual`)
 * and offers line breaks only after its own separators.
 */
it("keeps an identifier's characters and breaks it only at its separators", () => {
  const { container } = render(
    <MachineCode value="invoice.payment_failed" className="code" />,
  );
  const span = container.querySelector("span");
  expect(span).toHaveAttribute("translate", "no");
  expect(span).toHaveTextContent(/^invoice\.payment_failed$/u);
  expect(span?.querySelectorAll("wbr")).toHaveLength(2);
  expect(span?.innerHTML).toBe("invoice.<wbr>payment_<wbr>failed");
});
