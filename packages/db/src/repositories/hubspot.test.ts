import { describe, expect, it } from "vitest";

import { mergeContacts } from "./hubspot";

const portalId = "4410";
const planned = (overrides: Record<string, unknown> = {}) => ({
  id: "019a44ae-0000-7000-8000-00000000d001",
  hubspotId: "5001",
  name: "Ada Okafor",
  email: "ada@northstar.example",
  role: "VP Partnerships",
  labels: ["Decision maker"],
  matchedExisting: false,
  ...overrides,
});

describe("mergeContacts", () => {
  it("appends new people with their HubSpot identity and keeps the rest", () => {
    const merged = mergeContacts(
      [{ name: "Manual", email: "", role: "" }],
      { contacts: [planned()], primaryContactId: null },
      portalId,
    );
    expect(merged).toEqual([
      { name: "Manual", email: "", role: "" },
      {
        id: "019a44ae-0000-7000-8000-00000000d001",
        name: "Ada Okafor",
        email: "ada@northstar.example",
        role: "VP Partnerships",
        source: {
          provider: "hubspot",
          portalId,
          objectId: "5001",
          labels: ["Decision maker"],
        },
      },
    ]);
  });

  it("links a confirmed match and keeps the Commerce values", () => {
    const existing = {
      id: "019a44ae-0000-7000-8000-00000000d002",
      name: "Ada O.",
      email: "ada@northstar.example",
      role: "Partnerships",
    };
    const merged = mergeContacts(
      [existing],
      {
        contacts: [planned({ id: existing.id, matchedExisting: true })],
        primaryContactId: existing.id,
      },
      portalId,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      ...existing,
      primary: true,
      source: { objectId: "5001" },
    });
  });

  it("never adds the same HubSpot person twice, even after a manual edit", () => {
    const edited = {
      id: "019a44ae-0000-7000-8000-00000000d003",
      name: "Ada (edited by hand)",
      email: "",
      role: "",
      source: {
        provider: "hubspot" as const,
        portalId,
        objectId: "5001",
        labels: [],
      },
    };
    const merged = mergeContacts(
      [edited],
      { contacts: [planned()], primaryContactId: null },
      portalId,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Ada (edited by hand)");
  });

  it("moves primary only when a person chose one", () => {
    const first = {
      id: "019a44ae-0000-7000-8000-00000000d004",
      name: "A",
      email: "",
      role: "",
      primary: true,
    };
    expect(
      mergeContacts(
        [first],
        { contacts: [planned()], primaryContactId: null },
        portalId,
      )[0]?.primary,
    ).toBe(true);
    const moved = mergeContacts(
      [first],
      { contacts: [planned()], primaryContactId: planned().id },
      portalId,
    );
    expect(moved[0]?.primary).toBeUndefined();
    expect(moved[1]?.primary).toBe(true);
  });

  it("refuses a match that is gone and a list over the limit", () => {
    expect(() =>
      mergeContacts(
        [],
        {
          contacts: [planned({ matchedExisting: true })],
          primaryContactId: null,
        },
        portalId,
      ),
    ).toThrow("HUBSPOT_CONTACT_NOT_FOUND");
    const many = Array.from({ length: 20 }, (_, index) => ({
      name: `P${index}`,
      email: "",
      role: "",
    }));
    expect(() =>
      mergeContacts(
        many,
        { contacts: [planned()], primaryContactId: null },
        portalId,
      ),
    ).toThrow("HUBSPOT_CONTACT_LIMIT");
  });
});
