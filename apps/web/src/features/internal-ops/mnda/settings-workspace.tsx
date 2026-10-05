"use client";
import { useState } from "react";
import type {
  MndaErrorCode,
  MndaFieldError,
  MndaSigner,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  FormActions,
  Input,
  StateBanner,
  StatusBadge,
} from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import {
  configureMndaSigner,
  loadMndaSettings,
  saveMndaSettings,
  type MndaSettingsData,
} from "./actions";
import { formatMndaDate } from "./format";
import { mndaErrorLabels } from "./labels";
import styles from "./workspace.module.css";

/** Settings that bind Fil One: the notice email printed in new agreements and
 * who may countersign. Signatory managers only. */
export function MndaSettingsWorkspace({
  initial,
}: {
  initial: MndaSettingsData;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [data, setData] = useState(initial);
  const [noticeEmail, setNoticeEmail] = useState(initial.settings.noticeEmail);
  const [noticeError, setNoticeError] = useState<MndaErrorCode | null>(null);
  const [signer, setSigner] = useState<MndaSigner | null>(null);
  const [signerErrors, setSignerErrors] = useState<MndaFieldError[]>([]);
  const [busy, setBusy] = useState<"notice" | "signer" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  async function reload() {
    const result = await loadMndaSettings();
    if (result.ok) {
      setData(result.value);
      setNoticeEmail(result.value.settings.noticeEmail);
    }
  }
  async function saveNotice() {
    setMessage(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(noticeEmail.trim())) {
      setNoticeError("invalid_email");
      document.getElementById("mnda-notice-email")?.focus();
      return;
    }
    setBusy("notice");
    try {
      const result = await saveMndaSettings({
        noticeEmail: noticeEmail.trim(),
        version: data.settings.version,
      });
      if (!result.ok) {
        if (result.code === "settings_conflict") {
          // Someone saved first: show their value and keep this draft typed in.
          const latest = await loadMndaSettings();
          if (latest.ok) {
            setData(latest.value);
            setMessage({
              tone: "danger",
              text: t("operations.mnda.settings.changedElsewhere", {
                email: latest.value.settings.noticeEmail,
              }),
            });
            return;
          }
        }
        setNoticeError(result.fields?.[0]?.code ?? result.code);
        return;
      }
      setMessage({
        tone: "success",
        text: t("operations.mnda.settings.saved"),
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }
  async function saveSigner(next: MndaSigner) {
    setMessage(null);
    setBusy("signer");
    try {
      const result = await configureMndaSigner(next);
      if (!result.ok) {
        if (result.fields?.length) {
          setSignerErrors(result.fields);
          document
            .getElementById(`mnda-signer-${result.fields[0]?.field ?? "name"}`)
            ?.focus();
        } else
          setMessage({ tone: "danger", text: t(mndaErrorLabels[result.code]) });
        return;
      }
      setSigner(null);
      setMessage({
        tone: "success",
        text: t("operations.mnda.settings.signerSaved", { name: next.name }),
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }
  const signerError = (field: string) => {
    const error = signerErrors.find((e) => e.field === field);
    return error ? t(mndaErrorLabels[error.code]) : undefined;
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <a className={styles.back} href="/internal/mndas">
            {t("operations.mnda.settings.back")}
          </a>
          <h1>{t("operations.mnda.settings.title")}</h1>
          <p className={styles.muted}>
            {t("operations.mnda.settings.description")}
          </p>
        </div>
      </header>
      {message ? (
        <StateBanner
          tone={message.tone}
          live={message.tone === "danger" ? "assertive" : "polite"}
          title={message.text}
        />
      ) : null}
      <section className={styles.panel} aria-labelledby="mnda-notice-heading">
        <h2 id="mnda-notice-heading">
          {t("operations.mnda.settings.noticeTitle")}
        </h2>
        <p className={styles.muted}>
          {t("operations.mnda.settings.noticeDescription")}
        </p>
        <form
          noValidate
          className={styles.narrowForm}
          onSubmit={(e) => {
            e.preventDefault();
            void saveNotice();
          }}
        >
          <Input
            id="mnda-notice-email"
            type="email"
            label={t("operations.mnda.settings.noticeEmail")}
            value={noticeEmail}
            maxLength={254}
            required
            {...(noticeError ? { error: t(mndaErrorLabels[noticeError]) } : {})}
            onChange={(e) => {
              setNoticeEmail(e.target.value);
              setNoticeError(null);
            }}
          />
          {data.settings.updatedAt ? (
            <p className={styles.muted}>
              {t("operations.mnda.settings.lastChanged", {
                date: formatMndaDate(data.settings.updatedAt, locale),
              })}
            </p>
          ) : null}
          <FormActions className={styles.actions ?? ""}>
            <Button
              type="submit"
              loading={busy === "notice"}
              disabled={
                busy !== null ||
                noticeEmail.trim().toLowerCase() === data.settings.noticeEmail
              }
            >
              {t("common.save")}
            </Button>
          </FormActions>
        </form>
      </section>
      <section className={styles.panel} aria-labelledby="mnda-signers-heading">
        <div className={styles.registerHeader}>
          <div>
            <h2 id="mnda-signers-heading">{t("operations.mnda.signers")}</h2>
            <p className={styles.muted}>
              {t("operations.mnda.settings.signersDescription")}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => {
              setSignerErrors([]);
              setSigner({
                id: crypto.randomUUID(),
                name: "",
                email: "",
                title: "",
                active: true,
                isDefault: false,
              });
            }}
          >
            {t("operations.mnda.newSigner")}
          </Button>
        </div>
        <ul className={styles.signerList}>
          {data.signers.map((s) => (
            <li key={s.id} className={styles.signer}>
              <span>
                <strong>{s.name}</strong>
                <span className={styles.muted}>
                  {s.title} · {s.email}
                </span>
              </span>
              <span className={styles.signerMeta}>
                {s.isDefault ? (
                  <StatusBadge tone="info">
                    {t("operations.mnda.default")}
                  </StatusBadge>
                ) : null}
                {!s.active ? (
                  <StatusBadge>{t("operations.mnda.inactive")}</StatusBadge>
                ) : null}
                <Button
                  variant="quiet"
                  size="small"
                  aria-label={t("operations.mnda.settings.editSigner", {
                    name: s.name,
                  })}
                  onClick={() => {
                    setSignerErrors([]);
                    setSigner(s);
                  }}
                >
                  {t("common.edit")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {signer ? (
          <form
            noValidate
            className={styles.signerForm}
            aria-label={t("operations.mnda.settings.signerForm")}
            onSubmit={(e) => {
              e.preventDefault();
              void saveSigner(signer);
            }}
          >
            <div className={styles.fields}>
              {(["name", "email", "title"] as const).map((field) => {
                const error = signerError(field);
                return (
                  <Input
                    key={field}
                    id={`mnda-signer-${field}`}
                    label={t(
                      field === "title"
                        ? "operations.mnda.titleField"
                        : field === "name"
                          ? "common.name"
                          : "common.email",
                    )}
                    required
                    maxLength={field === "email" ? 254 : 180}
                    type={field === "email" ? "email" : "text"}
                    value={signer[field]}
                    {...(error ? { error } : {})}
                    onChange={(e) => {
                      setSigner({ ...signer, [field]: e.target.value });
                      setSignerErrors((errors) =>
                        errors.filter((x) => x.field !== field),
                      );
                    }}
                  />
                );
              })}
            </div>
            <Checkbox
              label={t("operations.mnda.active")}
              description={t("operations.mnda.settings.activeHelp")}
              checked={signer.active}
              onChange={(e) =>
                setSigner({
                  ...signer,
                  active: e.target.checked,
                  isDefault: e.target.checked ? signer.isDefault : false,
                })
              }
            />
            <Checkbox
              label={t("operations.mnda.default")}
              description={t("operations.mnda.settings.defaultHelp")}
              checked={signer.isDefault}
              onChange={(e) =>
                setSigner({
                  ...signer,
                  isDefault: e.target.checked,
                  active: e.target.checked ? true : signer.active,
                })
              }
            />
            <FormActions className={styles.actions ?? ""}>
              <Button
                type="submit"
                loading={busy === "signer"}
                disabled={busy !== null}
              >
                {t("common.save")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setSigner(null)}
              >
                {t("common.cancel")}
              </Button>
            </FormActions>
          </form>
        ) : null}
      </section>
    </main>
  );
}
