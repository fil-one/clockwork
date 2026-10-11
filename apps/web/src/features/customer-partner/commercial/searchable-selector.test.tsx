import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelector } from "./searchable-selector";

const options = [
  { id: "east", label: "Storage · US East", description: "USD price book" },
  { id: "west", label: "Storage · EU West", description: "EUR price book" },
];

function Picker({ onSubmit = () => undefined }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <SearchableSelector
        id="offer"
        label="Offer"
        placeholder="Search offer"
        value={value}
        onChange={setValue}
        options={options}
      />
      <button type="submit">Continue</button>
    </form>
  );
}

describe("searchable quote choices", () => {
  it("exposes all offers on focus and selects a visible choice with a pointer", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const input = screen.getByRole("combobox", { name: "Offer" });
    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("option", { name: /Storage · EU West/ }));
    expect(input).toHaveValue("Storage · EU West");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("filters descriptions and selects with Enter without submitting the quote", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<Picker onSubmit={submit} />);
    const input = screen.getByRole("combobox", { name: "Offer" });
    await user.type(input, "EUR");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}");
    expect(
      document.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      ),
    ).toHaveTextContent("Storage · EU West");
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Storage · EU West");
    expect(submit).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("reports no matches and supports Escape and Tab dismissal", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<Picker onSubmit={submit} />);
    const input = screen.getByRole("combobox", { name: "Offer" });
    await user.type(input, "no matching offer");
    expect(screen.getByRole("status")).toHaveTextContent("No results");
    await user.keyboard("{Enter}");
    expect(submit).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("no matching offer");
    await user.click(input);
    await user.tab();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
  });
});
