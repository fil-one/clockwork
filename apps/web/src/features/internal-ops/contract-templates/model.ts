import type {
  ContractTemplateVersionSummary,
  ContractType,
  TemplateBlock,
  TemplateContent,
} from "@clockwork/contracts";
import type { MessageId } from "@/src/i18n";

/**
 * What the template editor works on: template content as plain data. The
 * server validates it with `TemplateContentSchema` on every save, so the
 * editor only keeps the shape and leaves the rules to one place.
 */
export type EditableTemplate = TemplateContent;

/** A problem with a template, as the store reports it. */
export interface TemplateIssue {
  path: (string | number)[];
  message: string;
}

/** A new template with one heading and one paragraph to start from. */
export function blankTemplate(
  key: string,
  name: string,
  contractType: ContractType,
): EditableTemplate {
  return {
    id: key,
    contractType,
    name,
    requiresApproval: true,
    fields: [],
    sections: [],
    derived: [],
    document: {
      title: name.toUpperCase(),
      blocks: [
        { type: "heading", text: "1. FIRST SECTION" },
        {
          type: "paragraph",
          text: "Agreement wording. Use [[counterparty_name]] where the counterparty's name goes.",
        },
      ],
    },
  };
}

/**
 * Where an issue is: a block, a field, a section, a derived figure or the
 * title, from the path the schema reports, as a message and its values.
 */
export function issueLocation(
  issue: TemplateIssue,
  content: Partial<EditableTemplate> | null,
): { id: MessageId; values: Record<string, string | number> } {
  const [head, index, ...rest] = issue.path;
  const detail = rest.map(String).join(".");
  if (head === "document" && index === "blocks") {
    const position = Number(rest[0]);
    return {
      id: "operations.contractTemplates.issue.block",
      values: {
        number: position + 1,
        type: content?.document?.blocks?.[position]?.type ?? "",
      },
    };
  }
  if (head === "document" && index === "title")
    return { id: "operations.contractTemplates.issue.title", values: {} };
  if (
    (head === "fields" || head === "sections" || head === "derived") &&
    typeof index === "number"
  ) {
    const item = (content?.[head] as { id?: string }[] | undefined)?.[index];
    return {
      id: `operations.contractTemplates.issue.${head}`,
      values: { id: item?.id ?? String(index + 1), detail },
    };
  }
  return {
    id: "operations.contractTemplates.issue.other",
    values: { path: issue.path.join(".") },
  };
}

/** A table block as editable text: one row per line, cells split by `|`.
 * A `|` inside a cell is written `\|`. */
export function tableText(block: Extract<TemplateBlock, { type: "table" }>) {
  return block.rows
    .map((row) => row.map((cell) => cell.replaceAll("|", "\\|")).join(" | "))
    .join("\n");
}

export function tableRows(text: string): string[][] {
  const rows = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) =>
      line
        .split(/(?<!\\)\|/u)
        .map((cell) => cell.replaceAll("\\|", "|").trim()),
    );
  return rows.length ? rows : [[""]];
}

/** Choice options as editable text: `value | label` on each line. */
export function optionsText(
  options: readonly { value: string; label: { en: string } }[] | undefined,
) {
  return (options ?? [])
    .map((option) =>
      option.label.en === option.value
        ? option.value
        : `${option.value} | ${option.label.en}`,
    )
    .join("\n");
}

export function optionsFromText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value = "", label] = line.split("|").map((part) => part.trim());
      return { value, label: { en: label || value } };
    });
}

/** The JSON an administrator downloads or imports, two-space indented. */
export function templateJson(content: EditableTemplate) {
  return `${JSON.stringify(content, null, 2)}\n`;
}

/** One block's printed size, for the editor's outline. */
export function blockSummary(block: TemplateBlock): string {
  if (block.type === "pageBreak" || block.type === "table") return "";
  const text = block.text.replaceAll("**", "");
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** Every template with its versions, the one in use first. */
export interface TemplateGroup {
  key: string;
  name: string;
  active: ContractTemplateVersionSummary | null;
  versions: ContractTemplateVersionSummary[];
}

export function groupTemplates(
  rows: readonly ContractTemplateVersionSummary[],
): TemplateGroup[] {
  const groups = new Map<string, ContractTemplateVersionSummary[]>();
  for (const row of rows)
    groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  return [...groups.entries()]
    .map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const active = sorted.find((row) => row.status === "active") ?? null;
      return {
        key,
        name: (active ?? sorted[0])?.name ?? key,
        active,
        versions: sorted,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
