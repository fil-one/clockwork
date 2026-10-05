import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import type { MndaInput } from "../../../contracts/src/mnda";
import {
  mndaParagraphs,
  mndaTemplateHash,
  mndaTemplateVersion,
  renderMnda,
} from "./render";

const notice = { noticeEmail: "legal-notices@fil.one" };

/** Renders to a temporary file and returns what Poppler reads from it. */
async function extract(
  input: MndaInput,
  options = notice,
  signer = fixtureSigner,
) {
  const pdf = await renderMnda(input, signer, options);
  const dir = mkdtempSync(join(tmpdir(), "mnda-pdf-"));
  try {
    const path = join(dir, "document.pdf");
    writeFileSync(path, pdf.bytes);
    const run = (...args: string[]) =>
      execFileSync(args[0] ?? "", [...args.slice(1), path, "-"], {
        encoding: "utf8",
      });
    return {
      pdf,
      text: run("pdftotext", "-layout"),
      raw: run("pdftotext", "-raw"),
      bbox: run("pdftotext", "-bbox"),
      fonts: execFileSync("pdffonts", [path], { encoding: "utf8" }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const footer = /^.*Mutual Non-Disclosure Agreement · Ref .*$/gm;
const normalize = (s: string) => s.replace(footer, "").replace(/\s+/g, "");

interface Word {
  page: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
}
function words(bbox: string): Word[] {
  return bbox
    .split("<page ")
    .slice(1)
    .flatMap((page, index) =>
      [
        ...page.matchAll(
          /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
        ),
      ].map((m) => ({
        page: index + 1,
        xMin: Number(m[1]),
        yMin: Number(m[2]),
        xMax: Number(m[3]),
        yMax: Number(m[4]),
        text: m[5] ?? "",
      })),
    );
}

const long = {
  company:
    "Ştefan Łódź Société Générale Nguyễn International Holdings and Consolidated Strategic Infrastructure Investments Limited Liability Partnership Worldwide",
  shortName: "Société Générale Nguyễn",
  entityDescription:
    "Ontario corporation continued under the Business Corporations Act (Ontario) and extra-provincially registered in Alberta",
  streetAddress:
    "Suite 4500, Brookfield Place, 181 Bay Street, Bay Wellington Tower, North Building",
  locality: "Toronto, Ontario M5J 2T3, Canada (Attention: Legal Department)",
  noticesContact: "Maximiliana Alexandra Bartholomew-Featherstonehaugh",
  noticesEmail:
    "legal.notices.and.contracts.department@very-long-subsidiary-name.example.com",
  signerName: "Maximiliana Alexandra Bartholomew-Featherstonehaugh",
  signerTitle:
    "Executive Vice President, General Counsel and Corporate Secretary",
};
const allMissing = {
  entityDescription: "",
  streetAddress: "",
  locality: "",
  noticesContact: "",
  noticesEmail: "",
  signerTitle: "",
};
const variants: Record<string, MndaInput> = {
  team: { ...fixtureInput, detailsMode: "team" },
  "team, long values": { ...fixtureInput, ...long, detailsMode: "team" },
  "mixed, entity and locality missing": {
    ...fixtureInput,
    detailsMode: "mixed",
    entityDescription: "",
    locality: "",
  },
  "mixed, street only": {
    ...fixtureInput,
    ...allMissing,
    detailsMode: "mixed",
    streetAddress: "4 Example Street",
  },
  "mixed, all optional details missing": {
    ...fixtureInput,
    ...allMissing,
    detailsMode: "mixed",
  },
  "mixed, long values with gaps": {
    ...fixtureInput,
    ...long,
    detailsMode: "mixed",
    entityDescription: "",
    locality: "",
    signerTitle: "",
  },
  "mixed, long values with every optional detail missing": {
    ...fixtureInput,
    ...long,
    ...allMissing,
    detailsMode: "mixed",
  },
  recipient: { ...fixtureInput, detailsMode: "recipient" },
  "recipient, long reference": {
    ...fixtureInput,
    ...long,
    detailsMode: "recipient",
  },
};

it("preserves every supplied legal paragraph, both signers and all four tags in a deterministic PDF", async () => {
  const source = readFileSync(
    new URL(
      "../../../../docs/legal/FIL_One_Mutual_Non-Disclosure_Agreement_Template.docx",
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    mndaTemplateHash,
  );
  const [a, b] = await Promise.all([
    renderMnda(fixtureInput, fixtureSigner, notice),
    renderMnda(fixtureInput, fixtureSigner, notice),
  ]);
  expect(a.sha256).toBe(b.sha256);
  const { text } = await extract(fixtureInput);
  for (const paragraph of mndaParagraphs(fixtureInput, notice))
    expect(normalize(text)).toContain(normalize(paragraph));
  for (const tag of [
    "{{signature:1:y}}",
    "{{signature:2:y}}",
    "{{af_d_s:1:y}}",
    "{{af_d_s:2:y}}",
  ])
    expect(text).toContain(tag);
  expect(text).toContain(fixtureSigner.title);
  expect(text).not.toContain("m@fil.org");
  expect(text).toContain(fixtureInput.noticesEmail);
  expect(normalize(text)).toContain(
    normalize("as of October 2, 2026 (“Effective Date”)"),
  );
  expect(text).toContain("[Signature page follows]");
  for (let page = 1; page <= a.pages; page++)
    expect(text).toContain(
      `Mutual Non-Disclosure Agreement · Ref ${fixtureInput.id.slice(0, 8)} · Template ${mndaTemplateVersion} · ${page} / ${a.pages}`,
    );
}, 30000);

it("places every partner-completed blank and preserves all legal clauses", async () => {
  const { mndaRecipientFields } = await import("../../../contracts/src/mnda");
  const template = (await import("./template.json")).default;
  const { text } = await extract({ ...fixtureInput, detailsMode: "recipient" });
  for (const field of mndaRecipientFields)
    expect(text).toContain(`::${field.id}:`);
  for (const paragraph of template.paragraphs.slice(2))
    expect(normalize(text)).toContain(paragraph.replace(/\s+/g, ""));
  expect(text).not.toMatch(/\[Counterparty|\[Effective Date|\[jurisdiction/);
  expect(text).toContain("October 2, 2026");
  // The company field is only an internal reference in this mode.
  expect(text).not.toContain(fixtureInput.company);
  expect(normalize(text)).toContain(
    normalize(
      "Signature page to the Mutual Non-Disclosure Agreement between FIL One LLC and the counterparty named above, effective October 2, 2026.",
    ),
  );
}, 30000);

it.each([
  { entityDescription: "", locality: "" },
  {
    entityDescription: "",
    streetAddress: "",
    locality: "",
    noticesContact: "",
    noticesEmail: "",
    signerTitle: "",
  },
  {},
])(
  "preserves supplied mixed-mode data and exposes only missing fields: %j",
  async (missing) => {
    const { mndaSigningFields } = await import("../../../contracts/src/mnda");
    const template = (await import("./template.json")).default;
    const input = {
      ...fixtureInput,
      ...missing,
      detailsMode: "mixed" as const,
    };
    const { text } = await extract(input);
    const extractedIds = [...text.matchAll(/::([a-z_]+):/g)]
      .map((m) => m[1])
      .sort();
    expect(extractedIds).toEqual(
      mndaSigningFields(input)
        .map((f) => f.id)
        .sort(),
    );
    const normalized = normalize(text);
    for (const paragraph of template.paragraphs.slice(2))
      expect(normalized).toContain(paragraph.replace(/\s+/g, ""));
    for (const value of [
      input.company,
      input.shortName,
      input.signerName,
      input.streetAddress,
      input.noticesEmail,
    ].filter(Boolean))
      expect(normalized).toContain(value.replace(/\s+/g, ""));
    expect(text).not.toMatch(/\[Counterparty|\[Effective Date|\[jurisdiction/);
    expect(normalized).toContain(
      normalize(
        `between FIL One LLC and ${input.company}, effective October 2, 2026.`,
      ),
    );
  },
  30000,
);

it("keeps partial-detail previews compact, numbered and aligned without breaking supplied addresses", async () => {
  const { pdf, text } = await extract({
    ...fixtureInput,
    detailsMode: "mixed",
    streetAddress: "4 Example Street",
    entityDescription: "",
    locality: "",
    noticesEmail: "",
    noticesContact: "",
    signerTitle: "",
  });
  expect(pdf.pages).toBe(4);
  expect(text).toContain("4 Example Street,");
  for (let page = 1; page <= pdf.pages; page++)
    expect(text).toMatch(new RegExp(`${page}\\s*/\\s*${pdf.pages}`));
}, 30000);

it.each(
  (["team", "mixed", "recipient"] as const).flatMap((detailsMode) =>
    ["james@fil.one", "legal-notices@fil.one"].map((noticeEmail) => ({
      detailsMode,
      noticeEmail,
    })),
  ),
)(
  "prints the configured Fil One notice email in both notice locations, independent of the countersigner: %j",
  async ({ detailsMode, noticeEmail }) => {
    const signer = { ...fixtureSigner, email: "countersigner@example.com" };
    const { text } = await extract(
      {
        ...fixtureInput,
        detailsMode,
        ...(detailsMode === "mixed" ? { locality: "" } : {}),
      },
      { noticeEmail },
      signer,
    );
    expect(text.split(noticeEmail)).toHaveLength(3);
    expect(normalize(text)).toContain(`ATTN:email:${noticeEmail};`);
    expect(text).not.toContain(signer.email);
    expect(text).not.toContain("m@fil.org");
    // The countersigner still signs and is the Fil One notice contact.
    expect(text.split(signer.name).length).toBeGreaterThanOrEqual(3);
  },
  30000,
);

it("preserves partner details that contain the former template email", () => {
  const input = {
    ...fixtureInput,
    company: "m@fil.org Ventures",
    noticesEmail: "m@fil.org",
  };
  const paragraphs = mndaParagraphs(input, { noticeEmail: "james@fil.one" });
  expect(paragraphs[1]).toContain("m@fil.org Ventures");
  expect(paragraphs[1]).toContain("(ATTN: m@fil.org;");
  expect(paragraphs[1]).toContain("ATTN: email: james@fil.one;");
});

it.each([
  ["Ontario corporation", "an Ontario corporation"],
  ["Delaware corporation", "a Delaware corporation"],
  ["LLC organized in Wyoming", "an LLC organized in Wyoming"],
])(
  "chooses the article for the supplied entity type %s",
  async (entityDescription, expected) => {
    expect(
      mndaParagraphs({ ...fixtureInput, entityDescription }, notice)[1],
    ).toContain(`Example Corporation, ${expected} (ATTN:`);
    const { text } = await extract({
      ...fixtureInput,
      detailsMode: "mixed",
      entityDescription,
      locality: "",
    });
    expect(normalize(text)).toContain(normalize(`, ${expected} (ATTN:`));
  },
  30000,
);

it("embeds every font and prints Latin Extended names exactly", async () => {
  const name = "Łódź Société Générale Nguyễn Ştefan Ærøskøbing";
  for (const input of Object.values(variants)) {
    const { fonts } = await extract(input);
    const rows = fonts.split("\n").slice(2).filter(Boolean);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row).toMatch(/ yes +yes +yes /);
  }
  const { text } = await extract({
    ...fixtureInput,
    detailsMode: "team",
    company: name,
    signerName: "Đặng Thị Ngọc Hà",
  });
  expect(normalize(text.normalize("NFC"))).toContain(normalize(name));
  expect(normalize(text.normalize("NFC"))).toContain(
    normalize("Đặng Thị Ngọc Hà"),
  );
}, 60000);

it.each(Object.entries(variants))(
  "places every partner field inside the page, clear of printed text, with aligned signature rows: %s",
  async (_, input) => {
    const { raw, bbox, text } = await extract(input);
    const definitions = new Map(
      [
        ...raw.matchAll(/set=(f\d+):text:1:y:[^:]*::([a-z_]+):(\d+):(\d+):/g),
      ].map((m) => [
        m[1],
        {
          id: m[2] ?? "",
          width: Number(m[3]) * 0.75,
          height: Number(m[4]) * 0.75,
        },
      ]),
    );
    const all = words(bbox);
    const tags = all.filter((w) => /^\{\{f\d+\}\}$/.test(w.text));
    const visible = all.filter(
      (w) => w.yMax - w.yMin > 2 && !w.text.startsWith("{{"),
    );
    expect(tags).toHaveLength(definitions.size);
    const placed = new Set<string>();
    for (const tag of tags) {
      const alias = /^\{\{(f\d+)\}\}$/.exec(tag.text)?.[1] ?? "";
      const field = definitions.get(alias);
      expect(field, tag.text).toBeDefined();
      if (!field) continue;
      placed.add(field.id);
      const box = {
        xMin: tag.xMin,
        yMin: tag.yMin,
        xMax: tag.xMin + field.width,
        yMax: tag.yMin + field.height,
      };
      expect(box.xMin, field.id).toBeGreaterThanOrEqual(48 - 0.5);
      expect(box.xMax, field.id).toBeLessThanOrEqual(612 - 48 + 0.5);
      expect(box.yMin, field.id).toBeGreaterThanOrEqual(48 - 0.5);
      expect(box.yMax, field.id).toBeLessThanOrEqual(792 - 52);
      for (const word of visible.filter((w) => w.page === tag.page)) {
        const overlaps =
          word.xMin < box.xMax - 0.5 &&
          word.xMax > box.xMin + 0.5 &&
          word.yMin < box.yMax - 0.5 &&
          word.yMax > box.yMin + 0.5;
        expect(
          overlaps,
          `${field.id} overlaps "${word.text}" on page ${tag.page}`,
        ).toBe(false);
      }
    }
    expect(placed.size).toBe(definitions.size);
    // Nothing printed runs past the right margin, and the partner column
    // of the signature page keeps its values inside the column.
    const last = Math.max(...all.map((w) => w.page));
    for (const word of visible)
      expect(word.xMax, `"${word.text}" on page ${word.page}`).toBeLessThan(
        612 - 48 + 0.5,
      );
    for (const word of visible.filter(
      (w) => w.page === last && w.xMin >= 366 && w.yMin > 120,
    ))
      expect(word.xMax, word.text).toBeLessThan(368 + 196 + 0.5);
    for (const caption of [
      "Party",
      "Signature",
      "Name",
      "Title",
      "Date",
      "Company",
      "Attention",
      "Address",
      "Email",
    ]) {
      const positions = visible
        .filter(
          (w) =>
            w.page === last &&
            w.text === caption &&
            (w.xMin < 49 || Math.abs(w.xMin - 320) < 1),
        )
        .map((w) => [w.xMin, w.yMin] as const);
      expect(positions, caption).toHaveLength(2);
      const [left, right] = positions;
      expect(left?.[1], caption).toBe(right?.[1]);
      expect(left?.[1], caption).toBeLessThan(792 - 52);
    }
    expect(text).not.toMatch(/\[Counterparty|\[Effective Date|\[jurisdiction/);
  },
  30000,
);
