"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ContractTemplateVersionRecord,
  ContractTemplateVersionSummary,
} from "@clockwork/contracts";
import { Button, Dialog, InlineNotice, StatusBadge } from "@clockwork/ui";
import { useLocale, useTranslations } from "@/src/i18n/client";
import { contractTypeLabels } from "../contracts/copy";
import {
  activateTemplateVersion,
  discardTemplateDraft,
  duplicateTemplateVersion,
  renderTemplateSpecimen,
  retireTemplateVersion,
  saveTemplateDraft,
  type TemplateActionResult,
} from "./actions";
import { blockSummary, templateJson, type EditableTemplate } from "./model";
import { templateAdminHref, versionHref } from "./paths";
import { PdfReady, TemplateProblems, usePdfLink } from "./shared";
import { TemplateEditor } from "./template-editor";
import styles from "./templates.module.css";

type Failure = Extract<TemplateActionResult<unknown>, { ok: false }>;

const statusLabel = {
  draft: "operations.contractTemplates.status.draft",
  active: "operations.contractTemplates.status.active",
  retired: "operations.contractTemplates.status.retired",
} as const;
const statusTone = {
  draft: "warning",
  active: "success",
  retired: "neutral",
} as const;

function day(iso: string | null, locale: string) {
  return iso
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }).format(new Date(iso))
    : "";
}

/**
 * One version of a template: what it is, who activated it, and the actions
 * its status allows. A draft opens in the structured editor; any other
 * version is read only, and changing it means a new version.
 */
export function VersionView({
  record,
  others,
  demo,
}: {
  record: ContractTemplateVersionRecord;
  others: readonly ContractTemplateVersionSummary[];
  demo: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [content, setContent] = useState<EditableTemplate>(record.content);
  const [revision, setRevision] = useState(record.revision);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = usePdfLink();
  const draft = record.status === "draft";
  // Stored content that no longer validates or matches its hash: only
  // retiring (or discarding a draft) is offered.
  const broken = record.problem !== null;
  const [hash, setHash] = useState(record.contentHash);
  const active = others.find((row) => row.status === "active");

  async function act<T>(
    name: string,
    action: () => Promise<TemplateActionResult<T>>,
    done: (value: T) => void,
  ) {
    setBusy(name);
    setProblem(null);
    setSaved(false);
    const result = await action();
    setBusy(null);
    if (result.ok) done(result.value);
    else setProblem(result);
  }

  const save = () =>
    act(
      "save",
      () => saveTemplateDraft({ id: record.id, revision, content }),
      (value) => {
        setRevision(value.revision);
        setHash(value.contentHash);
        setDirty(false);
        setSaved(true);
      },
    );

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([templateJson(content)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${content.id}-${record.versionLabel}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.contractTemplates.demoTitle")}
          description={t("operations.contractTemplates.demoBody")}
        />
      ) : null}
      <section className={styles.card} aria-labelledby="version-heading">
        <div className={styles.groupHeader}>
          <h2 id="version-heading">
            {t("operations.contractTemplates.versionHeading", {
              name: content.name,
              version: record.versionLabel,
            })}
          </h2>
          <StatusBadge tone={statusTone[record.status]}>
            {t(statusLabel[record.status])}
          </StatusBadge>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{t("operations.contractTemplates.fact.key")}</dt>
            <dd className={styles.code}>{record.key}</dd>
          </div>
          <div>
            <dt>{t("operations.contractTemplates.fact.type")}</dt>
            <dd>{t(contractTypeLabels[content.contractType])}</dd>
          </div>
          <div>
            <dt>{t("operations.contractTemplates.fact.source")}</dt>
            <dd>{content.sourceNote || t("operations.contracts.none")}</dd>
          </div>
          <div>
            <dt>{t("operations.contractTemplates.fact.activated")}</dt>
            <dd>
              {record.activatedAt
                ? t("operations.contractTemplates.activatedBy", {
                    name: record.activatedByName ?? "",
                    date: day(record.activatedAt, locale),
                  })
                : t("operations.contractTemplates.notActivated")}
            </dd>
          </div>
          {record.retiredAt ? (
            <div>
              <dt>{t("operations.contractTemplates.fact.retired")}</dt>
              <dd>
                {t("operations.contractTemplates.activatedBy", {
                  name: record.retiredByName ?? "",
                  date: day(record.retiredAt, locale),
                })}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t("operations.contractTemplates.fact.used")}</dt>
            <dd>
              {t("operations.contractTemplates.usedBy", {
                count: record.usedBy,
              })}
            </dd>
          </div>
          <div>
            <dt>{t("operations.contractTemplates.fact.hash")}</dt>
            <dd className={styles.code}>{hash}</dd>
          </div>
        </dl>
        {draft && active ? (
          <p className={styles.muted}>
            {t("operations.contractTemplates.replaces", {
              version: active.versionLabel,
            })}{" "}
            <Link href={versionHref(active.id)}>
              {t("operations.contractTemplates.openVersion", {
                version: active.versionLabel,
              })}
            </Link>
          </p>
        ) : null}
        {broken ? (
          <InlineNotice
            tone="danger"
            title={t("operations.contractTemplates.broken.title")}
            description={t(
              record.problem === "CONTRACT_TEMPLATE_INTEGRITY"
                ? "operations.contractTemplates.error.integrity"
                : "operations.contractTemplates.broken.invalid",
            )}
          />
        ) : null}
        <div className={styles.actions}>
          {broken && record.status !== "active" ? null : record.status !==
            "active" ? (
            <Dialog
              title={t("operations.contractTemplates.activate.title", {
                version: record.versionLabel,
              })}
              description={t(
                active
                  ? "operations.contractTemplates.activate.replaces"
                  : "operations.contractTemplates.activate.body",
                { version: active?.versionLabel ?? "" },
              )}
              trigger={
                <Button type="button" disabled={demo || dirty}>
                  {t("operations.contractTemplates.activate.action")}
                </Button>
              }
              footer={
                <Button
                  type="button"
                  loading={busy === "activate"}
                  loadingLabel={t("operations.contractTemplates.saving")}
                  onClick={() =>
                    void act(
                      "activate",
                      () =>
                        activateTemplateVersion({ id: record.id, revision }),
                      () => router.refresh(),
                    )
                  }
                >
                  {t("operations.contractTemplates.activate.confirm")}
                </Button>
              }
            >
              <p>{t("operations.contractTemplates.activate.record")}</p>
            </Dialog>
          ) : (
            <Dialog
              title={t("operations.contractTemplates.retire.title", {
                version: record.versionLabel,
              })}
              description={t("operations.contractTemplates.retire.body")}
              trigger={
                <Button type="button" variant="secondary" disabled={demo}>
                  {t("operations.contractTemplates.retire.action")}
                </Button>
              }
              footer={
                <Button
                  type="button"
                  variant="danger"
                  loading={busy === "retire"}
                  loadingLabel={t("operations.contractTemplates.saving")}
                  onClick={() =>
                    void act(
                      "retire",
                      () => retireTemplateVersion({ id: record.id, revision }),
                      () => router.refresh(),
                    )
                  }
                >
                  {t("operations.contractTemplates.retire.confirm")}
                </Button>
              }
            >
              <p>{t("operations.contractTemplates.retire.note")}</p>
            </Dialog>
          )}
          {broken ? null : (
            <Button
              type="button"
              variant="secondary"
              loading={busy === "specimen"}
              loadingLabel={t(
                "operations.contractTemplates.specimen.rendering",
              )}
              onClick={() =>
                void act(
                  "specimen",
                  () => renderTemplateSpecimen(content),
                  (value) => setLink(value.pdf, value.fileName),
                )
              }
            >
              {t("operations.contractTemplates.specimen.action")}
            </Button>
          )}
          {draft || broken ? null : (
            <Button
              type="button"
              variant="secondary"
              disabled={demo}
              loading={busy === "duplicate"}
              loadingLabel={t("operations.contractTemplates.saving")}
              onClick={() =>
                void act(
                  "duplicate",
                  () => duplicateTemplateVersion({ id: record.id }),
                  (value) => router.push(versionHref(value.id)),
                )
              }
            >
              {t("operations.contractTemplates.duplicate")}
            </Button>
          )}
          {broken ? null : (
            <Button type="button" variant="quiet" onClick={download}>
              {t("operations.contractTemplates.download")}
            </Button>
          )}
          {draft ? (
            <Dialog
              title={t("operations.contractTemplates.discard.title")}
              description={t("operations.contractTemplates.discard.body")}
              trigger={
                <Button type="button" variant="quiet" disabled={demo}>
                  {t("operations.contractTemplates.discard.action")}
                </Button>
              }
              footer={
                <Button
                  type="button"
                  variant="danger"
                  loading={busy === "discard"}
                  loadingLabel={t("operations.contractTemplates.saving")}
                  onClick={() =>
                    void act(
                      "discard",
                      () => discardTemplateDraft({ id: record.id, revision }),
                      () => router.push(templateAdminHref),
                    )
                  }
                >
                  {t("operations.contractTemplates.discard.confirm")}
                </Button>
              }
            >
              <p>{t("operations.contractTemplates.discard.note")}</p>
            </Dialog>
          ) : null}
        </div>
        {dirty && draft ? (
          <p className={styles.muted}>
            {t("operations.contractTemplates.unsaved")}
          </p>
        ) : null}
        <PdfReady link={link} />
      </section>
      <TemplateProblems result={problem} content={content} />
      {saved ? (
        <InlineNotice
          tone="success"
          title={t("operations.contractTemplates.saved")}
          description={t("operations.contractTemplates.savedBody")}
        />
      ) : null}
      {broken ? null : draft && !demo ? (
        <>
          <TemplateEditor
            value={content}
            onChange={(next) => {
              setContent(next);
              setDirty(true);
              setSaved(false);
            }}
          />
          <div className={styles.actions}>
            <Button
              type="button"
              loading={busy === "save"}
              loadingLabel={t("operations.contractTemplates.saving")}
              onClick={() => void save()}
            >
              {t("operations.contractTemplates.saveDraft")}
            </Button>
          </div>
        </>
      ) : (
        <ReadOnlyOutline content={content} />
      )}
    </>
  );
}

/** A version's fields, sections and blocks, for reading. */
function ReadOnlyOutline({ content }: { content: EditableTemplate }) {
  const t = useTranslations();
  return (
    <>
      <section className={styles.card}>
        <h2>{t("operations.contractTemplates.editor.fields")}</h2>
        {content.fields.length ? (
          <ul className={styles.outline}>
            {content.fields.map((field) => (
              <li key={field.id}>
                <span className={styles.code}>[[{field.id}]]</span>{" "}
                {field.label.en}
                {field.section ? (
                  <span className={styles.sectionTag}>
                    {" "}
                    {t("operations.contractTemplates.inSection", {
                      section: field.section,
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{t("operations.contracts.none")}</p>
        )}
      </section>
      {content.sections.length ? (
        <section className={styles.card}>
          <h2>{t("operations.contractTemplates.editor.sections")}</h2>
          <ul className={styles.outline}>
            {content.sections.map((section) => (
              <li key={section.id}>
                {section.label.en}{" "}
                <span className={styles.sectionTag}>
                  {section.when
                    ? t("operations.contractTemplates.sectionWhen", {
                        field: section.when.field,
                        values: section.when.in.join(", "),
                      })
                    : t(
                        section.default
                          ? "operations.contractTemplates.sectionOn"
                          : "operations.contractTemplates.sectionOff",
                      )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className={styles.card}>
        <h2>{t("operations.contractTemplates.editor.blocks")}</h2>
        <ol className={styles.outline}>
          {content.document.blocks.map((block, index) => (
            <li key={index}>
              {block.type === "pageBreak"
                ? t("operations.contractTemplates.block.pageBreak")
                : block.type === "table"
                  ? t("operations.contractTemplates.tableRows", {
                      count: block.rows.length,
                    })
                  : blockSummary(block)}
              {block.section ? (
                <span className={styles.sectionTag}>
                  {" "}
                  {t("operations.contractTemplates.inSection", {
                    section: block.section,
                  })}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
