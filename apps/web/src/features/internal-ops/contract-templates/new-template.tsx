"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  contractTypes,
  type ContractType,
  type TemplateContent,
} from "@clockwork/contracts";
import { Button, Fieldset, InlineNotice, Input, Select } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";
import { contractTypeLabels } from "../contracts/copy";
import {
  checkTemplateFile,
  createTemplateDraft,
  renderTemplateSpecimen,
  type TemplateActionResult,
} from "./actions";
import { versionHref } from "./paths";
import { blankTemplate } from "./model";
import { PdfReady, TemplateProblems, usePdfLink } from "./shared";
import styles from "./templates.module.css";

type Failure = Extract<TemplateActionResult<unknown>, { ok: false }>;

/**
 * Two ways to start a template: import a JSON file, checked and previewed
 * before it is saved, or start blank in the editor. Either way the result
 * is a draft; nothing is in use until an administrator activates it.
 */
export function NewTemplate({ demo }: { demo: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const draftId = useRef(crypto.randomUUID());
  const [checked, setChecked] = useState<{
    content: TemplateContent;
    nextVersion: number;
    activeVersion: string | null;
  } | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | "specimen" | null>(null);
  const [link, setLink] = usePdfLink();
  // The file box opens once the page is interactive, so a file chosen while
  // it loads is never silently dropped.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function read(file: File | undefined) {
    if (!file) return;
    setChecked(null);
    setProblem(null);
    if (file.size > 900_000) {
      setProblem({ ok: false, code: "CONTRACT_TEMPLATE_TOO_LARGE" });
      return;
    }
    setBusy("check");
    const result = await checkTemplateFile(await file.text());
    setBusy(null);
    if (result.ok) setChecked(result.value);
    else setProblem(result);
  }

  async function save(content: TemplateContent, origin: "blank" | "import") {
    setBusy("save");
    setProblem(null);
    const result = await createTemplateDraft({
      id: draftId.current,
      origin,
      content,
    });
    setBusy(null);
    if (result.ok) router.push(versionHref(result.value.id));
    else setProblem(result);
  }

  async function specimen(content: TemplateContent) {
    setBusy("specimen");
    const result = await renderTemplateSpecimen(content);
    setBusy(null);
    if (result.ok) setLink(result.value.pdf, result.value.fileName);
    else setProblem(result);
  }

  return (
    <>
      {demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.contractTemplates.demoTitle")}
          description={t("operations.contractTemplates.demoBody")}
        />
      ) : null}
      <TemplateProblems result={problem} content={checked?.content ?? null} />
      <section className={styles.card} aria-labelledby="import-heading">
        <h2 id="import-heading">
          {t("operations.contractTemplates.import.title")}
        </h2>
        <p className={styles.muted}>
          {t("operations.contractTemplates.import.description")}
        </p>
        <Input
          type="file"
          accept="application/json,.json"
          label={t("operations.contractTemplates.import.file")}
          help={t("operations.contractTemplates.import.fileHelp")}
          onChange={(event) => void read(event.target.files?.[0])}
          disabled={!ready || busy === "check"}
        />
        {checked ? (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>{t("operations.contractTemplates.fact.name")}</dt>
                <dd>{checked.content.name}</dd>
              </div>
              <div>
                <dt>{t("operations.contractTemplates.fact.key")}</dt>
                <dd className={styles.code}>{checked.content.id}</dd>
              </div>
              <div>
                <dt>{t("operations.contractTemplates.fact.becomes")}</dt>
                <dd>
                  {t(
                    checked.activeVersion
                      ? "operations.contractTemplates.import.nextVersion"
                      : "operations.contractTemplates.import.firstVersion",
                    {
                      version: `v${checked.nextVersion}`,
                      active: checked.activeVersion ?? "",
                    },
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("operations.contractTemplates.fact.contents")}</dt>
                <dd>
                  {t("operations.contractTemplates.import.contents", {
                    fields: checked.content.fields.length,
                    sections: checked.content.sections.length,
                    blocks: checked.content.document.blocks.length,
                  })}
                </dd>
              </div>
              {checked.content.sourceNote ? (
                <div>
                  <dt>{t("operations.contractTemplates.fact.source")}</dt>
                  <dd>{checked.content.sourceNote}</dd>
                </div>
              ) : null}
            </dl>
            <div className={styles.actions}>
              <Button
                type="button"
                disabled={demo}
                loading={busy === "save"}
                loadingLabel={t("operations.contractTemplates.saving")}
                onClick={() => void save(checked.content, "import")}
              >
                {t("operations.contractTemplates.import.save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={busy === "specimen"}
                loadingLabel={t(
                  "operations.contractTemplates.specimen.rendering",
                )}
                onClick={() => void specimen(checked.content)}
              >
                {t("operations.contractTemplates.specimen.action")}
              </Button>
            </div>
            <PdfReady link={link} />
          </>
        ) : null}
      </section>
      <BlankTemplate
        demo={demo}
        busy={busy === "save"}
        onCreate={(content) => void save(content, "blank")}
      />
    </>
  );
}

function BlankTemplate({
  demo,
  busy,
  onCreate,
}: {
  demo: boolean;
  busy: boolean;
  onCreate: (content: TemplateContent) => void;
}) {
  const t = useTranslations();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ContractType>("other");
  return (
    <section className={styles.card} aria-labelledby="blank-heading">
      <h2 id="blank-heading">
        {t("operations.contractTemplates.blank.title")}
      </h2>
      <Fieldset
        legend={t("operations.contractTemplates.blank.legend")}
        description={t("operations.contractTemplates.blank.description")}
      >
        <div className={styles.grid}>
          <Input
            label={t("operations.contractTemplates.fact.name")}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t("operations.contractTemplates.fact.key")}
            help={t("operations.contractTemplates.keyHelp")}
            value={key}
            maxLength={63}
            onChange={(event) => setKey(event.target.value.toLowerCase())}
          />
          <Select
            label={t("operations.contractTemplates.fact.type")}
            value={type}
            onChange={(event) => setType(event.target.value as ContractType)}
            options={contractTypes.map((value) => ({
              value,
              label: t(contractTypeLabels[value]),
            }))}
          />
        </div>
      </Fieldset>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          disabled={demo}
          loading={busy}
          loadingLabel={t("operations.contractTemplates.saving")}
          onClick={() => onCreate(blankTemplate(key.trim(), name.trim(), type))}
        >
          {t("operations.contractTemplates.blank.create")}
        </Button>
      </div>
    </section>
  );
}
