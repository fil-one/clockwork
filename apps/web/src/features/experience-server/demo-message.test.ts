import { describe, expect, it } from "vitest";

import { demoText } from "@clockwork/testing/demo-localized-text";

import { translatorFor } from "@/src/i18n/catalogs";
import { formattingLocales, type Locale } from "@/src/i18n/locales";

import {
  ago,
  dateRange,
  demoMessage,
  formatDemoFact,
  inMonth,
  money,
  onDate,
  onDay,
  percent,
  resolveDemoContent,
  terabytes,
  type DemoReader,
} from "./demo-message";

function reader(locale: Locale): DemoReader {
  return {
    locale,
    formatting: formattingLocales[locale],
    t: translatorFor(locale),
  };
}

describe("demo facts", () => {
  it("formats each fact with the reader's formatting locale", () => {
    const pt = formattingLocales.pt;
    expect(formatDemoFact(money("18480000", "USD"), pt)).toBe(
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "USD",
      }).format(184800),
    );
    expect(formatDemoFact(onDate("2027-03-31"), pt)).toBe(
      new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2027-03-31T00:00:00Z")),
    );
    expect(formatDemoFact(onDay("2026-08-28"), "de-DE")).toBe("28. Aug.");
    expect(formatDemoFact(inMonth("2026-07"), "fr-FR")).toBe("juillet 2026");
    expect(formatDemoFact(terabytes(400), "fr-FR")).toBe(
      new Intl.NumberFormat("fr-FR", {
        style: "unit",
        unit: "terabyte",
      }).format(400),
    );
    expect(formatDemoFact(percent(0.62), "en-US")).toBe("62%");
    expect(formatDemoFact(ago(12, "minute"), "ja-JP")).toBe(
      new Intl.RelativeTimeFormat("ja-JP", { numeric: "auto" }).format(
        -12,
        "minute",
      ),
    );
    expect(formatDemoFact(dateRange("2026-06-01", "2026-06-30"), "es-ES")).toBe(
      new Intl.DateTimeFormat("es-ES", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).formatRange(
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-06-30T00:00:00Z"),
      ),
    );
  });

  it("reads a calendar date in UTC whatever the server's zone", () => {
    // A bare ISO date parsed as local time shows the previous day west of UTC.
    expect(formatDemoFact(onDay("2026-01-01"), "en-US")).toBe("Jan 1");
  });
});

describe("demo messages at the read boundary", () => {
  const record = {
    id: "invoice-meridian-overdue",
    title: demoText({
      en: "Committed capacity · overdue",
      es: "Capacidad contratada · vencida",
      fr: "Capacité souscrite · en retard",
      de: "Vertraglich zugesagte Kapazität · überfällig",
      ja: "契約容量・期限超過",
      pt: "Capacidade contratada · vencida",
      zh: "承诺容量 · 已逾期",
      ar: "السعة المتعاقد عليها · متأخرة السداد",
    }),
    dateLabel: demoMessage("experience.data.date.dueOverdueDays", {
      date: onDay("2026-07-15"),
      count: 16,
    }),
    value: money("1540000", "USD"),
    context: [
      {
        label: demoMessage("recordKind.service"),
        value: "eu-west-2",
      },
    ],
    authoritative: {
      dueAt: "2026-07-15T23:59:59.000Z",
      amountMinor: "1540000",
    },
  };

  it("renders messages, facts and demo text for one reader and leaves facts alone", () => {
    const resolved = resolveDemoContent(record, reader("de"));
    expect(resolved).toEqual({
      id: "invoice-meridian-overdue",
      title: "Vertraglich zugesagte Kapazität · überfällig",
      dateLabel: "Fällig am 15. Juli · 16 Tage überfällig",
      value: "15.400,00\u00a0$",
      context: [{ label: "Service", value: "eu-west-2" }],
      authoritative: {
        dueAt: "2026-07-15T23:59:59.000Z",
        amountMinor: "1540000",
      },
    });
  });

  it("selects the plural form the reader's language needs", () => {
    const overdue = (count: number, locale: Locale) =>
      resolveDemoContent(
        demoMessage("experience.data.date.dueOverdueDays", {
          date: onDay("2026-07-15"),
          count,
        }),
        reader(locale),
      );
    expect(overdue(1, "en")).toBe("Due Jul 15 · 1 day overdue");
    expect(overdue(16, "en")).toBe("Due Jul 15 · 16 days overdue");
    expect(overdue(2, "ar")).toContain("يومين");
    expect(overdue(16, "ar")).toContain("يومًا");
  });

  it("survives the demo state store unchanged, as JSON", () => {
    const stored = JSON.parse(JSON.stringify(record)) as typeof record;
    expect(resolveDemoContent(stored, reader("ja"))).toEqual(
      resolveDemoContent(record, reader("ja")),
    );
  });
});
