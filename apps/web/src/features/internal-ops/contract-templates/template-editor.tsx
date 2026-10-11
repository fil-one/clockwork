"use client";
// i18n-exempt-file: starting values for new fields, options and sections are English template data that the administrator edits, never interface text

import { useId, useState, type ReactNode } from "react";
import {
  contractTypes,
  templateFieldKinds,
  type ContractType,
  type TemplateBlock,
  type TemplateDerived,
  type TemplateField,
  type TemplateFieldKind,
  type TemplateSection,
} from "@clockwork/contracts";
import { Button, Checkbox, Input, Select, Textarea } from "@clockwork/ui";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { contractTypeLabels } from "../contracts/copy";
import {
  optionsFromText,
  optionsText,
  tableRows,
  tableText,
  type EditableTemplate,
} from "./model";
import styles from "./templates.module.css";

const wide = styles.wide ?? "";

const kindLabels: Readonly<Record<TemplateFieldKind, MessageId>> = {
  text: "operations.contractTemplates.kind.text",
  email: "operations.contractTemplates.kind.email",
  date: "operations.contractTemplates.kind.date",
  choice: "operations.contractTemplates.kind.choice",
  number: "operations.contractTemplates.kind.number",
  decimal: "operations.contractTemplates.kind.decimal",
  percent: "operations.contractTemplates.kind.percent",
  line_items: "operations.contractTemplates.kind.lineItems",
};

const blockLabels: Readonly<Record<TemplateBlock["type"], MessageId>> = {
  heading: "operations.contractTemplates.block.heading",
  paragraph: "operations.contractTemplates.block.paragraph",
  table: "operations.contractTemplates.block.table",
  pageBreak: "operations.contractTemplates.block.pageBreak",
};

/**
 * Text the editor parses into a value, such as a comma-separated list. What
 * the administrator typed stays on screen while it still means the stored
 * value, so a trailing comma, space or new line is not swallowed; anything
 * else (a reorder, a load) shows the stored value afresh.
 */
function useParsedText<T>(
  value: T,
  format: (value: T) => string,
  parse: (text: string) => T,
) {
  const [text, setText] = useState(() => format(value));
  const shown =
    JSON.stringify(parse(text)) === JSON.stringify(value)
      ? text
      : format(value);
  return [
    shown,
    (next: string) => {
      setText(next);
      return parse(next);
    },
  ] as const;
}

const commaList = {
  format: (items: readonly string[]) => items.join(", "),
  parse: (text: string) =>
    text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
};
const widthList = {
  format: (widths: readonly number[] | undefined) => widths?.join(", ") ?? "",
  parse: (text: string) => {
    const widths = text
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((width) => Number.isFinite(width) && width > 0);
    return widths.length ? widths : undefined;
  },
};

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function ItemActions({
  index,
  count,
  name,
  onChange,
  extra,
}: {
  index: number;
  count: number;
  name: string;
  onChange: (action: "up" | "down" | "remove") => void;
  extra?: ReactNode;
}) {
  const t = useTranslations();
  return (
    <div className={styles.actions}>
      {extra}
      <Button
        type="button"
        size="small"
        variant="quiet"
        disabled={index === 0}
        aria-label={t("operations.contractTemplates.editor.upNamed", { name })}
        onClick={() => onChange("up")}
      >
        {t("operations.contractTemplates.editor.up")}
      </Button>
      <Button
        type="button"
        size="small"
        variant="quiet"
        disabled={index === count - 1}
        aria-label={t("operations.contractTemplates.editor.downNamed", {
          name,
        })}
        onClick={() => onChange("down")}
      >
        {t("operations.contractTemplates.editor.down")}
      </Button>
      <Button
        type="button"
        size="small"
        variant="quiet"
        aria-label={t("operations.contractTemplates.editor.removeNamed", {
          name,
        })}
        onClick={() => onChange("remove")}
      >
        {t("operations.contractTemplates.editor.remove")}
      </Button>
    </div>
  );
}

/** Applies an item action to a list. */
function listAction<T>(
  items: readonly T[],
  index: number,
  action: "up" | "down" | "remove",
): T[] {
  if (action === "remove") return items.filter((_, i) => i !== index);
  return move(items, index, action === "up" ? index - 1 : index + 1);
}

function SectionSelect({
  id,
  value,
  sections,
  onChange,
}: {
  id: string;
  value: string | undefined;
  sections: readonly TemplateSection[];
  onChange: (section: string | undefined) => void;
}) {
  const t = useTranslations();
  return (
    <Select
      id={id}
      label={t("operations.contractTemplates.editor.section")}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || undefined)}
      options={[
        { value: "", label: t("operations.contractTemplates.editor.always") },
        ...sections.map((section) => ({
          value: section.id,
          label: section.label.en || section.id,
        })),
      ]}
    />
  );
}

/** Sets or clears an optional key, so cleared values leave the JSON. */
function withOptional<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined,
): T {
  const next = { ...item };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

function FieldEditor({
  field,
  sections,
  onChange,
}: {
  field: TemplateField;
  sections: readonly TemplateSection[];
  onChange: (field: TemplateField) => void;
}) {
  const t = useTranslations();
  const base = useId();
  const set = <K extends keyof TemplateField>(
    key: K,
    value: TemplateField[K] | undefined,
  ) => onChange(withOptional(field, key, value));
  const [options, typeOptions] = useParsedText(
    field.options ?? [],
    optionsText,
    optionsFromText,
  );
  return (
    <div className={styles.grid}>
      <Input
        id={`${base}-id`}
        label={t("operations.contractTemplates.editor.fieldId")}
        help={t("operations.contractTemplates.editor.fieldIdHelp")}
        value={field.id}
        onChange={(event) => set("id", event.target.value)}
      />
      <Input
        id={`${base}-label`}
        label={t("operations.contractTemplates.editor.label")}
        value={field.label.en}
        onChange={(event) =>
          onChange({
            ...field,
            label: { ...field.label, en: event.target.value },
          })
        }
      />
      <Select
        id={`${base}-kind`}
        label={t("operations.contractTemplates.editor.kind")}
        value={field.kind}
        onChange={(event) => {
          const kind = event.target.value as TemplateFieldKind;
          let next: TemplateField = { ...field, kind };
          if (kind === "choice" && !next.options)
            next.options = [
              { value: "Option 1", label: { en: "Option 1" } },
              { value: "Option 2", label: { en: "Option 2" } },
            ];
          if (kind !== "choice")
            next = withOptional(next, "options", undefined);
          if (kind === "line_items")
            next = withOptional(
              withOptional({ ...next, required: true }, "default", undefined),
              "maxLength",
              undefined,
            );
          onChange(next);
        }}
        options={templateFieldKinds.map((kind) => ({
          value: kind,
          label: t(kindLabels[kind]),
        }))}
      />
      <SectionSelect
        id={`${base}-section`}
        value={field.section}
        sections={sections}
        onChange={(section) => set("section", section)}
      />
      {field.kind !== "line_items" ? (
        <Input
          id={`${base}-default`}
          label={t("operations.contractTemplates.editor.default")}
          value={field.default ?? ""}
          onChange={(event) => set("default", event.target.value)}
        />
      ) : null}
      {field.kind === "text" ? (
        <Input
          id={`${base}-max`}
          label={t("operations.contractTemplates.editor.maxLength")}
          inputMode="numeric"
          value={field.maxLength === undefined ? "" : String(field.maxLength)}
          onChange={(event) =>
            set(
              "maxLength",
              /^\d+$/.test(event.target.value)
                ? Number(event.target.value)
                : undefined,
            )
          }
        />
      ) : null}
      <Checkbox
        id={`${base}-required`}
        label={t("operations.contractTemplates.editor.required")}
        checked={field.required}
        disabled={field.kind === "line_items"}
        onChange={(event) => set("required", event.target.checked)}
      />
      <Textarea
        id={`${base}-help`}
        fieldClassName={wide}
        label={t("operations.contractTemplates.editor.help")}
        value={field.help?.en ?? ""}
        rows={2}
        onChange={(event) =>
          set(
            "help",
            event.target.value ? { en: event.target.value } : undefined,
          )
        }
      />
      {field.kind === "choice" ? (
        <Textarea
          id={`${base}-options`}
          fieldClassName={wide}
          label={t("operations.contractTemplates.editor.options")}
          help={t("operations.contractTemplates.editor.optionsHelp")}
          value={options}
          rows={3}
          onChange={(event) => set("options", typeOptions(event.target.value))}
        />
      ) : null}
    </div>
  );
}

function SectionEditor({
  section,
  choiceFields,
  onChange,
}: {
  section: TemplateSection;
  choiceFields: readonly TemplateField[];
  onChange: (section: TemplateSection) => void;
}) {
  const t = useTranslations();
  const base = useId();
  const [values, typeValues] = useParsedText(
    section.when?.in ?? [],
    commaList.format,
    commaList.parse,
  );
  return (
    <div className={styles.grid}>
      <Input
        id={`${base}-id`}
        label={t("operations.contractTemplates.editor.sectionId")}
        value={section.id}
        onChange={(event) => onChange({ ...section, id: event.target.value })}
      />
      <Input
        id={`${base}-label`}
        label={t("operations.contractTemplates.editor.label")}
        value={section.label.en}
        onChange={(event) =>
          onChange({ ...section, label: { en: event.target.value } })
        }
      />
      <Select
        id={`${base}-when`}
        label={t("operations.contractTemplates.editor.when")}
        value={section.when?.field ?? ""}
        onChange={(event) =>
          onChange(
            withOptional(
              section,
              "when",
              event.target.value
                ? { field: event.target.value, in: section.when?.in ?? [] }
                : undefined,
            ),
          )
        }
        options={[
          { value: "", label: t("operations.contractTemplates.editor.ticked") },
          ...choiceFields.map((field) => ({
            value: field.id,
            label: field.label.en || field.id,
          })),
        ]}
      />
      {section.when ? (
        <Input
          id={`${base}-values`}
          label={t("operations.contractTemplates.editor.whenValues")}
          help={t("operations.contractTemplates.editor.whenValuesHelp")}
          value={values}
          onChange={(event) =>
            onChange({
              ...section,
              when: {
                field: section.when?.field ?? "",
                in: typeValues(event.target.value),
              },
            })
          }
        />
      ) : (
        <Checkbox
          id={`${base}-default`}
          label={t("operations.contractTemplates.editor.sectionDefault")}
          checked={section.default}
          onChange={(event) =>
            onChange({ ...section, default: event.target.checked })
          }
        />
      )}
      <Textarea
        id={`${base}-help`}
        fieldClassName={wide}
        label={t("operations.contractTemplates.editor.help")}
        value={section.help?.en ?? ""}
        rows={2}
        onChange={(event) =>
          onChange(
            withOptional(
              section,
              "help",
              event.target.value ? { en: event.target.value } : undefined,
            ),
          )
        }
      />
    </div>
  );
}

function DerivedEditor({
  figure,
  sections,
  onChange,
}: {
  figure: TemplateDerived;
  sections: readonly TemplateSection[];
  onChange: (figure: TemplateDerived) => void;
}) {
  const t = useTranslations();
  const base = useId();
  const [operands, typeOperands] = useParsedText(
    figure.of,
    commaList.format,
    commaList.parse,
  );
  return (
    <div className={styles.grid}>
      <Input
        id={`${base}-id`}
        label={t("operations.contractTemplates.editor.fieldId")}
        value={figure.id}
        onChange={(event) => onChange({ ...figure, id: event.target.value })}
      />
      <Select
        id={`${base}-op`}
        label={t("operations.contractTemplates.editor.op")}
        value={figure.op}
        onChange={(event) =>
          onChange({
            ...figure,
            op: event.target.value as TemplateDerived["op"],
          })
        }
        options={[
          {
            value: "percent_of",
            label: t("operations.contractTemplates.op.percentOf"),
          },
          {
            value: "product",
            label: t("operations.contractTemplates.op.product"),
          },
          { value: "sum", label: t("operations.contractTemplates.op.sum") },
        ]}
      />
      <Input
        id={`${base}-of`}
        label={t("operations.contractTemplates.editor.operands")}
        help={t("operations.contractTemplates.editor.operandsHelp")}
        value={operands}
        onChange={(event) =>
          onChange({ ...figure, of: typeOperands(event.target.value) })
        }
      />
      <Input
        id={`${base}-decimals`}
        label={t("operations.contractTemplates.editor.decimals")}
        inputMode="numeric"
        value={String(figure.decimals)}
        onChange={(event) =>
          onChange({
            ...figure,
            decimals: /^\d$/.test(event.target.value)
              ? Number(event.target.value)
              : 0,
          })
        }
      />
      <SectionSelect
        id={`${base}-section`}
        value={figure.section}
        sections={sections}
        onChange={(section) =>
          onChange(withOptional(figure, "section", section))
        }
      />
    </div>
  );
}

function BlockEditor({
  block,
  sections,
  onChange,
}: {
  block: TemplateBlock;
  sections: readonly TemplateSection[];
  onChange: (block: TemplateBlock) => void;
}) {
  const t = useTranslations();
  const base = useId();
  const section = block.section;
  const keep = (next: TemplateBlock) =>
    onChange(section ? { ...next, section } : next);
  const table = block.type === "table" ? block : null;
  const [widths, typeWidths] = useParsedText(
    table?.widths,
    widthList.format,
    widthList.parse,
  );
  const [rows, typeRows] = useParsedText(
    table?.rows ?? [[""]],
    (value) => tableText({ type: "table", header: true, rows: value }),
    tableRows,
  );
  return (
    <div className={styles.grid}>
      <Select
        id={`${base}-type`}
        label={t("operations.contractTemplates.editor.blockType")}
        value={block.type}
        onChange={(event) => {
          const type = event.target.value as TemplateBlock["type"];
          const text =
            "text" in block
              ? block.text
              : block.type === "table"
                ? tableText(block)
                : "";
          keep(
            type === "pageBreak"
              ? { type }
              : type === "table"
                ? { type, header: true, rows: tableRows(text) }
                : { type, text: text || " " },
          );
        }}
        options={(Object.keys(blockLabels) as TemplateBlock["type"][]).map(
          (type) => ({ value: type, label: t(blockLabels[type]) }),
        )}
      />
      <SectionSelect
        id={`${base}-section`}
        value={section}
        sections={sections}
        onChange={(value) => onChange(withOptional(block, "section", value))}
      />
      {block.type === "table" ? (
        <>
          <Checkbox
            id={`${base}-header`}
            label={t("operations.contractTemplates.editor.tableHeader")}
            checked={block.header}
            onChange={(event) =>
              onChange({ ...block, header: event.target.checked })
            }
          />
          <Input
            id={`${base}-widths`}
            label={t("operations.contractTemplates.editor.tableWidths")}
            help={t("operations.contractTemplates.editor.tableWidthsHelp")}
            value={widths}
            onChange={(event) =>
              onChange(
                withOptional(block, "widths", typeWidths(event.target.value)),
              )
            }
          />
          <Textarea
            id={`${base}-rows`}
            fieldClassName={wide}
            label={t("operations.contractTemplates.editor.tableRows")}
            help={t("operations.contractTemplates.editor.tableRowsHelp")}
            value={rows}
            rows={Math.min(12, block.rows.length + 1)}
            onChange={(event) =>
              onChange({ ...block, rows: typeRows(event.target.value) })
            }
          />
        </>
      ) : block.type === "pageBreak" ? null : (
        <Textarea
          id={`${base}-text`}
          fieldClassName={wide}
          label={t("operations.contractTemplates.editor.text")}
          help={t("operations.contractTemplates.editor.textHelp")}
          value={block.text}
          rows={
            block.type === "heading"
              ? 1
              : Math.min(10, 2 + Math.ceil(block.text.length / 110))
          }
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
      )}
    </div>
  );
}

function List<T>({
  title,
  description,
  items,
  name,
  render,
  onChange,
  add,
  addLabel,
  insertBelow,
}: {
  title: string;
  description: string;
  items: readonly T[];
  name: (item: T, index: number) => string;
  render: (item: T, index: number) => ReactNode;
  onChange: (items: T[]) => void;
  add: () => T;
  addLabel: string;
  insertBelow?: string;
}) {
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      <p className={styles.muted}>{description}</p>
      {items.map((item, index) => (
        <div key={index} className={styles.item}>
          <div className={styles.itemHeader}>
            <strong>{name(item, index)}</strong>
            <ItemActions
              index={index}
              count={items.length}
              name={name(item, index)}
              onChange={(action) => onChange(listAction(items, index, action))}
              {...(insertBelow
                ? {
                    extra: (
                      <Button
                        type="button"
                        size="small"
                        variant="quiet"
                        onClick={() =>
                          onChange([
                            ...items.slice(0, index + 1),
                            add(),
                            ...items.slice(index + 1),
                          ])
                        }
                      >
                        {insertBelow}
                      </Button>
                    ),
                  }
                : {})}
            />
          </div>
          {render(item, index)}
        </div>
      ))}
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...items, add()])}
        >
          {addLabel}
        </Button>
      </div>
    </section>
  );
}

/**
 * The structured editor for a draft: basics, fields, optional sections,
 * derived figures and the document's blocks. Rules are checked when the
 * draft is saved; the editor keeps the shape only.
 */
export function TemplateEditor({
  value,
  onChange,
}: {
  value: EditableTemplate;
  onChange: (value: EditableTemplate) => void;
}) {
  const t = useTranslations();
  const base = useId();
  const choiceFields = value.fields.filter(
    (field) => field.kind === "choice" && !field.section,
  );
  return (
    <>
      <section className={styles.card}>
        <h2>{t("operations.contractTemplates.editor.basics")}</h2>
        <div className={styles.grid}>
          <Input
            id={`${base}-name`}
            label={t("operations.contractTemplates.fact.name")}
            help={t("operations.contractTemplates.editor.nameHelp")}
            value={value.name}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...value, name: event.target.value })
            }
          />
          <Select
            id={`${base}-type`}
            label={t("operations.contractTemplates.fact.type")}
            value={value.contractType}
            onChange={(event) =>
              onChange({
                ...value,
                contractType: event.target.value as ContractType,
              })
            }
            options={contractTypes.map((type) => ({
              value: type,
              label: t(contractTypeLabels[type]),
            }))}
          />
          <Input
            id={`${base}-source`}
            label={t("operations.contractTemplates.fact.source")}
            help={t("operations.contractTemplates.editor.sourceHelp")}
            value={value.sourceNote ?? ""}
            maxLength={200}
            onChange={(event) =>
              onChange(withOptional(value, "sourceNote", event.target.value))
            }
          />
          <Checkbox
            id={`${base}-approval`}
            label={t("operations.contractTemplates.editor.approval")}
            description={t("operations.contractTemplates.editor.approvalHelp")}
            checked={value.requiresApproval}
            onChange={(event) =>
              onChange({ ...value, requiresApproval: event.target.checked })
            }
          />
          <Input
            id={`${base}-title`}
            fieldClassName={wide}
            label={t("operations.contractTemplates.editor.title")}
            value={value.document.title}
            maxLength={200}
            onChange={(event) =>
              onChange({
                ...value,
                document: { ...value.document, title: event.target.value },
              })
            }
          />
        </div>
      </section>
      <List
        title={t("operations.contractTemplates.editor.fields")}
        description={t("operations.contractTemplates.editor.fieldsHelp")}
        items={value.fields}
        name={(field) => `[[${field.id}]] ${field.label.en}`}
        render={(field, index) => (
          <FieldEditor
            field={field}
            sections={value.sections}
            onChange={(next) =>
              onChange({
                ...value,
                fields: value.fields.map((f, i) => (i === index ? next : f)),
              })
            }
          />
        )}
        onChange={(fields) => onChange({ ...value, fields })}
        add={(): TemplateField => ({
          id: `field_${value.fields.length + 1}`,
          kind: "text",
          required: true,
          label: { en: "New field" },
        })}
        addLabel={t("operations.contractTemplates.editor.addField")}
      />
      <List
        title={t("operations.contractTemplates.editor.sections")}
        description={t("operations.contractTemplates.editor.sectionsHelp")}
        items={value.sections}
        name={(section) => section.label.en || section.id}
        render={(section, index) => (
          <SectionEditor
            section={section}
            choiceFields={choiceFields}
            onChange={(next) =>
              onChange({
                ...value,
                sections: value.sections.map((s, i) =>
                  i === index ? next : s,
                ),
              })
            }
          />
        )}
        onChange={(sections) => onChange({ ...value, sections })}
        add={(): TemplateSection => ({
          id: `section_${value.sections.length + 1}`,
          label: { en: "New optional section" },
          default: false,
        })}
        addLabel={t("operations.contractTemplates.editor.addSection")}
      />
      <List
        title={t("operations.contractTemplates.editor.derived")}
        description={t("operations.contractTemplates.editor.derivedHelp")}
        items={value.derived}
        name={(figure) => `[[${figure.id}]]`}
        render={(figure, index) => (
          <DerivedEditor
            figure={figure}
            sections={value.sections}
            onChange={(next) =>
              onChange({
                ...value,
                derived: value.derived.map((d, i) => (i === index ? next : d)),
              })
            }
          />
        )}
        onChange={(derived) => onChange({ ...value, derived })}
        add={(): TemplateDerived => ({
          id: `figure_${value.derived.length + 1}`,
          op: "percent_of",
          of: ["", ""],
          decimals: 0,
        })}
        addLabel={t("operations.contractTemplates.editor.addDerived")}
      />
      <List
        title={t("operations.contractTemplates.editor.blocks")}
        description={t("operations.contractTemplates.editor.blocksHelp")}
        items={value.document.blocks}
        name={(block, index) =>
          t("operations.contractTemplates.issue.block", {
            number: index + 1,
            type: t(blockLabels[block.type]),
          })
        }
        render={(block, index) => (
          <BlockEditor
            block={block}
            sections={value.sections}
            onChange={(next) =>
              onChange({
                ...value,
                document: {
                  ...value.document,
                  blocks: value.document.blocks.map((b, i) =>
                    i === index ? next : b,
                  ),
                },
              })
            }
          />
        )}
        onChange={(blocks) =>
          onChange({ ...value, document: { ...value.document, blocks } })
        }
        add={(): TemplateBlock => ({ type: "paragraph", text: " " })}
        addLabel={t("operations.contractTemplates.editor.addBlock")}
        insertBelow={t("operations.contractTemplates.editor.insertBelow")}
      />
    </>
  );
}
