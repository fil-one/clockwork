import { describe, expect, it } from "vitest";

import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { messageModules, translatorFor } from "@/src/i18n/catalogs";
import { formattingLocales, locales, type Locale } from "@/src/i18n/locales";

import {
  collectionMemberCounts,
  collectionMemberRole,
  customerCollectionRecord,
  presentCustomerRecord,
} from "./collection-record";
import type { CustomerCollectionRow } from "./collection-state";
import {
  customerCollections,
  type CustomerCollectionKey,
} from "./customer-data";

function projection(data: Readonly<Record<string, unknown>>): ProjectionRecord {
  return {
    id: "50000000-0000-4000-8000-000000002001",
    recordKey: String(data.id),
    aggregateType: "amendments",
    aggregateId: "50000000-0000-4000-8000-000000002001",
    accountId: "11000000-0000-4000-8000-000000000001",
    audience: "customer",
    channel: "amendments",
    version: 1,
    // The demo serves every fixture at request time; this is that instant.
    sourceUpdatedAt: "2026-09-24T09:00:00.000Z",
    projectedAt: "2026-09-24T09:00:00.000Z",
    stale: false,
    data,
  };
}

/** The demo read path: resolve demo text, then read the payload. */
function rows(key: CustomerCollectionKey, locale: Locale) {
  const formatting = { locale: formattingLocales[locale], timeZone: "UTC" };
  const t = translatorFor(locale);
  return customerCollections[key].records.map((fixture) =>
    presentCustomerRecord(
      customerCollectionRecord(
        projection(
          resolveDemoText(
            JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>,
            locale,
          ),
        ),
      ),
      t,
      formatting,
    ),
  );
}

function shownText(row: CustomerCollectionRow): string[] {
  return [
    row.title,
    row.description,
    row.statusLabel,
    row.value,
    row.updatedLabel,
    ...row.context.flatMap((entry) => [entry.label, entry.value]),
  ];
}

const keys = Object.keys(customerCollections) as CustomerCollectionKey[];

/**
 * Words a language keeps from English on purpose, as the catalogs mark them
 * with `sameAsEnglish` (French "Service", German "Status"). Only a marked value
 * may match the English row.
 */
function markedCognates(locale: Locale): ReadonlySet<string> {
  const marked = new Set<string>();
  for (const { messages } of Object.values(messageModules))
    for (const message of Object.values(
      messages as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    )) {
      const value = message[locale];
      if (value && typeof value === "object" && "sameAsEnglish" in value)
        marked.add(String(value.sameAsEnglish));
    }
  return marked;
}

/**
 * Text a reader may see unchanged in every language: people's names, record
 * references, product and marketplace names, and email addresses.
 */
const neverTranslated =
  /^(?:[A-Z][a-z]+ [A-Z][a-z]+|[A-Z0-9-]+|Coupa|Fil One, Inc\.|Cloud Service Agreement v3\.2|(?:AWS|Azure|Google Cloud) Marketplace|[\w.]+@[\w.]+)$/u;

describe("customer collection fixtures in the reader's language", () => {
  it("leaves no English interface text in any row, in any language", () => {
    for (const key of keys) {
      const english = rows(key, "en").map(shownText);
      for (const locale of locales.filter((l) => l !== "en")) {
        const cognates = markedCognates(locale);
        rows(key, locale).forEach((row, index) => {
          shownText(row).forEach((text, field) => {
            if (neverTranslated.test(text) || cognates.has(text)) return;
            // An amount or date alone may legitimately format the same way.
            if (!/\p{L}/u.test(text)) return;
            expect(
              text,
              `${key} ${row.id} field ${field} in ${locale}`,
            ).not.toBe(english[index]?.[field]);
          });
        });
      }
    }
  });

  it("states amounts and dates with the reader's formatting, not US English", () => {
    const [capacity] = rows("amendments", "de");
    expect(capacity?.value).toBe(
      `+${new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(10560)} pro Jahr`,
    );
    expect(capacity?.context).toContainEqual({
      label: "Wirksam ab",
      value: new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2026-08-15T00:00:00Z")),
    });
    const users = rows("users", "pt");
    expect(users.find((row) => row.id === "INV-JUNO")?.updatedLabel).toBe(
      `Convite enviado em ${new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2026-07-28T13:40:00Z"))}`,
    );
  });

  it("keeps each fixture's own date, so the date sort orders the fixtures", () => {
    const [latest] = rows("amendments", "en");
    expect(latest?.updatedAt).toBe("2026-07-31T14:42:00Z");
  });

  it("isolates inserted values in Arabic and pluralizes by CLDR category", () => {
    const [, , schedule] = rows("amendments", "ar");
    expect(schedule?.context[0]).toEqual({
      label: "الخدمات",
      value: "خدمتان نشطتان",
    });
    const [primary] = rows("marketplace", "ar");
    expect(primary?.context[1]?.value).toBe(
      "\u2068AWS\u2069 هو التاجر المسؤول عن المعاملة",
    );
  });
});

describe("production projection text", () => {
  it("is shown as written, and its context is read as label and value", () => {
    const record = customerCollectionRecord(
      projection({
        id: "70000000-0000-4000-8000-000000000001",
        title: "AMD-70000000",
        description: "Uplift effective Sep 1, 2026",
        status: "pending",
        statusLabel: "Pending",
        risk: "medium",
        owner: "AMD-70000000",
        value: "Uplift",
        valueSort: 1,
        updatedLabel: "2026-07-31T16:00:00.000Z",
        context: [{ label: "Kind", value: "Uplift" }],
      }),
    );
    expect(record.updatedAt).toBe("2026-09-24T09:00:00.000Z");
    expect(
      presentCustomerRecord(record, translatorFor("pt"), {
        locale: "pt-BR",
        timeZone: "UTC",
      }),
    ).toMatchObject({
      statusLabel: "Pending",
      value: "Uplift",
      context: [{ label: "Kind", value: "Uplift" }],
    });
  });

  it("rejects a fact this page has no words for instead of showing a key", () => {
    expect(() =>
      customerCollectionRecord(
        projection({
          id: "AMD-1",
          title: "Title",
          description: "Description",
          status: "pending",
          statusLabel: { detail: "somethingNew" },
          risk: "low",
          owner: "Maya Chen",
          value: "Value",
          valueSort: 1,
          updatedLabel: "Updated",
          context: [],
        }),
      ),
    ).toThrow("Projection field statusLabel is invalid");
  });
});

describe("the people /account counts", () => {
  const users = customerCollections.users.records.map((fixture) => ({
    data: resolveDemoText(
      JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>,
      "en",
    ),
  }));

  it("counts only members who can act, not invitations or removed members", () => {
    // Five rows: three active members, one invitation, one removed member.
    expect(users).toHaveLength(5);
    expect(collectionMemberCounts(users)).toEqual({
      withAccess: 3,
      invitations: 1,
    });
  });

  it("finds the owner and billing contact from the role fact", () => {
    expect(
      users
        .filter((user) => collectionMemberRole(user.data) === "owner")
        .map((user) => user.data.title),
    ).toEqual(["Maya Chen"]);
    expect(
      users
        .filter((user) => collectionMemberRole(user.data) === "billing")
        .map((user) => user.data.title),
    ).toEqual(["Elias Romero"]);
  });
});
