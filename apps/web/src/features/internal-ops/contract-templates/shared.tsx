"use client";

import { useEffect, useState } from "react";
import { InlineNotice, buttonClassName } from "@clockwork/ui";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { errorMessage } from "../contracts/copy";
import type { TemplateActionResult } from "./actions";
import {
  issueLocation,
  type EditableTemplate,
  type TemplateIssue,
} from "./model";
import styles from "./templates.module.css";

/** A PDF returned as base64, as a link the browser can open. */
export function usePdfLink() {
  const [link, setLink] = useState<{ url: string; fileName: string } | null>(
    null,
  );
  useEffect(
    () => () => {
      if (link) URL.revokeObjectURL(link.url);
    },
    [link],
  );
  return [
    link,
    (pdf: string, fileName: string) => {
      const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      setLink({
        url: URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        ),
        fileName,
      });
    },
  ] as const;
}

export function PdfReady({
  link,
}: {
  link: { url: string; fileName: string } | null;
}) {
  const t = useTranslations();
  if (!link) return null;
  return (
    <InlineNotice
      tone="success"
      title={t("operations.contractTemplates.specimen.ready")}
      description={t("operations.contractTemplates.specimen.readyBody")}
      action={
        <a
          className={buttonClassName({ variant: "secondary" })}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          download={link.fileName}
        >
          {t("operations.contractTemplates.specimen.open")}
        </a>
      }
    />
  );
}

/** A failed template action: its issues, or the message for its code. */
export function TemplateProblems({
  result,
  content,
}: {
  result: Extract<TemplateActionResult<unknown>, { ok: false }> | null;
  content: Partial<EditableTemplate> | null;
}) {
  const t = useTranslations();
  if (!result) return null;
  if (!result.issues?.length)
    return (
      <InlineNotice
        tone="danger"
        title={t("operations.contractTemplates.error.title")}
        description={t(templateErrorMessage(result.code))}
        live="assertive"
      />
    );
  return (
    <InlineNotice
      tone="danger"
      title={t("operations.contractTemplates.issues.title", {
        count: result.issues.length,
      })}
      description={
        <ul className={styles.issues}>
          {result.issues.slice(0, 50).map((issue: TemplateIssue, index) => {
            const where = issueLocation(issue, content);
            return (
              <li key={index}>
                <strong>{t(where.id, where.values)}</strong>{" "}
                {/* i18n-exempt: the template schema's own diagnostic, in English for administrators */}
                <span>{issue.message}</span>
              </li>
            );
          })}
        </ul>
      }
      live="assertive"
    />
  );
}

const templateErrors: Readonly<Record<string, MessageId>> = {
  CONTRACT_TEMPLATE_JSON: "operations.contractTemplates.error.json",
  CONTRACT_TEMPLATE_TOO_LARGE: "operations.contractTemplates.error.tooLarge",
  CONTRACT_TEMPLATE_REVISION_CONFLICT:
    "operations.contractTemplates.error.revision",
  CONTRACT_TEMPLATE_NOT_DRAFT: "operations.contractTemplates.error.notDraft",
  CONTRACT_TEMPLATE_NOT_ACTIVE: "operations.contractTemplates.error.notActive",
  CONTRACT_TEMPLATE_KEY_CHANGED:
    "operations.contractTemplates.error.keyChanged",
  CONTRACT_TEMPLATE_INTEGRITY: "operations.contractTemplates.error.integrity",
  CONTRACT_TEMPLATE_IDEMPOTENCY_CONFLICT:
    "operations.contractTemplates.error.revision",
};

export function templateErrorMessage(code: string): MessageId {
  return templateErrors[code] ?? errorMessage(code);
}
