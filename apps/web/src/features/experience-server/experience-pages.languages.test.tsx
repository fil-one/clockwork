import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "@/src/i18n";
import { messageModules } from "@/src/i18n/catalogs";

import type { ProjectionRecord } from "./model";

const reader = vi.hoisted(() => ({ locale: "en" }));
const mocks = vi.hoisted(() => ({
  getRouteRoles: vi.fn(),
  loadPortalRecords: vi.fn(),
}));

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const { formattingLocales } = await import("@/src/i18n/locales");
  return {
    getTranslations: () => Promise.resolve(translatorFor(reader.locale)),
    getLocale: () => Promise.resolve(reader.locale),
    getFormattingLocale: () =>
      Promise.resolve(
        formattingLocales[reader.locale as keyof typeof formattingLocales],
      ),
  };
});
vi.mock("@/src/features/shell/route-session", () => ({
  getRouteRoles: mocks.getRouteRoles,
}));
vi.mock("./portal-view-loader", () => ({
  loadPortalRecords: mocks.loadPortalRecords,
}));
// Client children are covered by their own tests; stubs keep this render on
// the server components' own text.
vi.mock("./projection-action-buttons", () => ({
  ProjectionActionButtons: () => null,
}));
vi.mock("./artifact-delivery-list", () => ({
  ArtifactDeliveryList: () => null,
}));
vi.mock("./evidence-upload-control", () => ({
  EvidenceUploadControl: () => null,
}));

import { InternalProjectionPage } from "./internal-projection-page";
import { ProjectionDetailPage } from "./projection-detail-page";

/** Record content is data: the same in every language, so it is excluded. */
const recordData = {
  title: "RECORD-TITLE",
  reference: "queue-legal-meridian",
  statusLabel: "STATUS-LABEL",
  status: "pending",
  risk: "high",
  owner: "OWNER-NAME",
  value: "VALUE",
  valueLabel: "VALUE-LABEL",
  term: "TERM",
  dateLabel: "DATE-LABEL",
  nextAction: "NEXT-ACTION",
  context: [{ label: "CONTEXT-LABEL", value: "CONTEXT-VALUE" }],
  allowedActions: [],
};

function record(): ProjectionRecord {
  return {
    id: "projection-queue",
    recordKey: "queue-legal-meridian",
    aggregateType: "exception_case",
    aggregateId: "aggregate-queue",
    accountId: null,
    audience: "internal",
    channel: "queues",
    version: 3,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:01:00.000Z",
    stale: false,
    data: recordData,
  };
}

/** Every visible text node, with the record's own data removed. */
function productText(container: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "")
      .replace(/[\u2068\u2069]/gu, "")
      .trim();
    if (text) texts.push(text);
  }
  for (const element of container.querySelectorAll("[aria-label]"))
    texts.push(element.getAttribute("aria-label") ?? "");
  return texts.filter(
    (text) =>
      !/^[A-Z-]+$|queue-legal-meridian|PAGE-/u.test(text) &&
      !Object.values(recordData).includes(text),
  );
}

async function renderPages() {
  const detail = render(
    await ProjectionDetailPage({
      audience: "internal",
      channel: "queues",
      title: "PAGE-TITLE",
      description: "PAGE-DESCRIPTION",
    }),
  );
  const detailText = productText(detail.container);
  detail.unmount();
  const queue = render(
    await InternalProjectionPage({
      channel: "approvals",
      title: "PAGE-TITLE",
      description: "PAGE-DESCRIPTION",
    }),
  );
  const queueText = productText(queue.container);
  queue.unmount();
  return [...detailText, ...queueText];
}

beforeEach(() => {
  mocks.getRouteRoles.mockResolvedValue(["internal_operator"]);
  mocks.loadPortalRecords.mockResolvedValue({
    records: [record()],
    generatedAt: "2026-08-01T12:00:00.000Z",
    stale: true,
  });
});

afterEach(() => {
  reader.locale = "en";
});

/**
 * Words a language deliberately shares with English ("Status" in German and
 * Portuguese, "Actions" in French) are marked in the catalogs; those are the
 * only identical strings allowed.
 */
function markedSameAsEnglish(locale: Locale): ReadonlySet<string> {
  const same = new Set<string>();
  for (const { messages } of Object.values(messageModules))
    for (const message of Object.values(
      messages as Readonly<Record<string, Record<string, unknown>>>,
    )) {
      const value = message[locale];
      if (value && typeof value === "object" && "sameAsEnglish" in value)
        same.add(String(value.sameAsEnglish));
    }
  return same;
}

const languages: readonly Exclude<Locale, "en">[] = [
  "es",
  "fr",
  "de",
  "ja",
  "pt",
  "zh",
  "ar",
];

describe("the experience pages carry no English in another language", () => {
  it.each(languages)("%s", async (locale) => {
    reader.locale = "en";
    const english = new Set(await renderPages());
    reader.locale = locale;
    const translated = await renderPages();

    // Anything the product writes that comes back identical to the English
    // render is English left behind. Numbers and identifiers are excluded.
    const same = markedSameAsEnglish(locale);
    const leftovers = translated.filter(
      (text) => english.has(text) && /\p{L}{2}/u.test(text) && !same.has(text),
    );
    expect(leftovers).toEqual([]);
    if (["ja", "zh", "ar"].includes(locale))
      expect(
        translated.filter(
          (text) =>
            /^[\p{Script=Latin}\s·,.:0-9-]+$/u.test(text) &&
            /[A-Za-z]{3}/u.test(text),
        ),
      ).toEqual([]);
  });
});
