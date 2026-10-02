"use client";
import { useEffect, useRef, useState } from "react";
import type {
  MndaInput,
  MndaRecord,
  MndaSigner,
  MndaState,
} from "@clockwork/contracts";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import {
  configureMndaSigner,
  downloadMnda,
  loadMndas,
  operateMnda,
  prepareMnda,
} from "./actions";
import styles from "./workspace.module.css";

type Data = Awaited<ReturnType<typeof loadMndas>>;
const fields: readonly (keyof Omit<
  MndaInput,
  "id" | "countersignerId" | "detailsMode"
>)[] = [
  "company",
  "shortName",
  "entityDescription",
  "streetAddress",
  "locality",
  "noticesContact",
  "noticesEmail",
  "signerName",
  "signerEmail",
  "signerTitle",
  "effectiveDate",
];
const fieldLabels: Record<(typeof fields)[number], MessageId> = {
  company: "operations.mnda.company",
  shortName: "operations.mnda.shortName",
  entityDescription: "operations.mnda.entityDescription",
  streetAddress: "operations.mnda.streetAddress",
  locality: "operations.mnda.locality",
  noticesContact: "operations.mnda.noticesContact",
  noticesEmail: "operations.mnda.noticesEmail",
  signerName: "operations.mnda.signerName",
  signerEmail: "operations.mnda.signerEmail",
  signerTitle: "operations.mnda.signerTitle",
  effectiveDate: "operations.mnda.effectiveDate",
};
const states: Record<MndaState, MessageId> = {
  draft: "status.draft",
  preparing: "status.pending",
  ready: "status.ready",
  sending: "status.pending",
  sent: "operations.mnda.sent",
  viewed: "operations.mnda.viewed",
  awaiting_countersignature: "operations.mnda.awaiting",
  completed: "operations.mnda.completed",
  declined: "status.declined",
  expired: "status.expired",
  canceled: "status.canceled",
  attention: "status.blocked",
};
const terminal = (r: MndaRecord) =>
  ["completed", "declined", "expired", "canceled"].includes(r.state);
function pdfUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function MndaWorkspace({ initial }: { initial: Data }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [data, setData] = useState(initial),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{
    record: MndaRecord;
    url: string;
  } | null>(null);
  const [detailsMode, setDetailsMode] = useState<"team" | "recipient">("team");
  const [signer, setSigner] = useState<MndaSigner | null>(null);
  const requestId = useRef<string | null>(null);
  const blob = useRef<string | null>(null);
  const showPdf = (record: MndaRecord, base64: string) => {
    if (blob.current) URL.revokeObjectURL(blob.current);
    blob.current = pdfUrl(base64);
    setPreview({ record, url: blob.current });
  };
  const closePreview = () => {
    setPreview(null);
    if (blob.current) URL.revokeObjectURL(blob.current);
    blob.current = null;
  };
  useEffect(
    () => () => {
      if (blob.current) URL.revokeObjectURL(blob.current);
    },
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      void loadMndas()
        .then(setData)
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
      setData(await loadMndas());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const operate = (
    record: MndaRecord,
    operation: "send" | "sync" | "remind" | "cancel",
  ) =>
    run(async () => {
      if (
        operation === "cancel" &&
        !window.confirm(t("operations.mnda.confirmCancel"))
      )
        return;
      await operateMnda({ id: record.id, operation });
      if (operation === "send") {
        closePreview();
        setCreating(false);
        requestId.current = null;
      }
    });
  const openRecord = (record: MndaRecord, kind: "original" | "executed") =>
    run(async () =>
      showPdf(record, await downloadMnda({ id: record.id, kind })),
    );
  const filtered = data.records.filter((r) =>
    `${r.input.company} ${r.input.signerEmail} ${r.ownerName} ${r.countersigner.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <h1>{t("operations.mnda.title")}</h1>
          <p>{t("operations.mnda.description")}</p>
        </div>
        <button
          onClick={() => {
            requestId.current = crypto.randomUUID();
            setCreating(true);
            closePreview();
          }}
          disabled={busy}
        >
          {t("operations.mnda.new")}
        </button>
      </header>
      {!data.ready ? (
        <p className={styles.notice} role="status">
          {t("operations.mnda.notReady")}
        </p>
      ) : null}
      {data.testMode ? (
        <p className={styles.notice} role="status">
          {t("operations.mnda.testMode")}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {t("operations.mnda.error")}
        </p>
      ) : null}
      {busy ? <p role="status">{t("operations.mnda.working")}</p> : null}
      {creating && !preview ? (
        <form
          className={styles.panel}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void run(async () => {
              const input = Object.fromEntries(form.entries());
              const result = await prepareMnda({
                ...input,
                id: requestId.current ?? crypto.randomUUID(),
              });
              showPdf(result.record, result.pdf);
              setCreating(false);
            });
          }}
        >
          <h2>{t("operations.mnda.new")}</h2>
          <label>
            {t("operations.mnda.detailsMode")}
            <select
              name="detailsMode"
              value={detailsMode}
              onChange={(e) =>
                setDetailsMode(e.target.value as "team" | "recipient")
              }
            >
              <option value="team">{t("operations.mnda.teamDetails")}</option>
              <option value="recipient">
                {t("operations.mnda.recipientDetails")}
              </option>
            </select>
          </label>
          <p>
            {t(
              detailsMode === "recipient"
                ? "operations.mnda.recipientHint"
                : "operations.mnda.latin",
            )}
          </p>
          <div className={styles.fields}>
            {fields
              .filter(
                (field) =>
                  detailsMode === "team" ||
                  [
                    "company",
                    "signerName",
                    "signerEmail",
                    "effectiveDate",
                  ].includes(field),
              )
              .map((field) => (
                <label key={field}>
                  {t(
                    detailsMode === "recipient" && field === "company"
                      ? "operations.mnda.partnerReference"
                      : fieldLabels[field],
                  )}
                  <input
                    name={field}
                    required
                    maxLength={
                      field.toLowerCase().includes("email") ? 254 : 180
                    }
                    type={
                      field === "effectiveDate"
                        ? "date"
                        : field.toLowerCase().includes("email")
                          ? "email"
                          : "text"
                    }
                    defaultValue={
                      field === "effectiveDate"
                        ? new Date(
                            Date.now() -
                              new Date().getTimezoneOffset() * 60_000,
                          )
                            .toISOString()
                            .slice(0, 10)
                        : undefined
                    }
                  />
                </label>
              ))}
            <label>
              {t("operations.mnda.countersigner")}
              <select
                name="countersignerId"
                required
                defaultValue={
                  data.signers.find((s) => s.isDefault && s.active)?.id
                }
              >
                {data.signers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p>{t("operations.mnda.order")}</p>
          <div className={styles.actions}>
            <button disabled={busy}>{t("operations.mnda.preview")}</button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setCreating(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}
      {preview ? (
        <section className={styles.panel}>
          <h2>{preview.record.input.company}</h2>
          <p>{t("operations.mnda.review")}</p>
          <p>
            {preview.record.input.signerName} ·{" "}
            {preview.record.input.signerEmail} →{" "}
            {preview.record.countersigner.name} ·{" "}
            {preview.record.countersigner.email}
          </p>
          <p>
            {t("operations.mnda.effectiveDate")}:{" "}
            {preview.record.input.effectiveDate}
          </p>
          <div className={styles.actions}>
            <a href={preview.url} target="_blank" rel="noreferrer">
              {t("operations.mnda.openPdf")}
            </a>
            {["draft", "ready", "preparing", "sending"].includes(
              preview.record.state,
            ) ? (
              <button
                disabled={busy || !data.ready}
                onClick={() => void operate(preview.record, "send")}
              >
                {t("operations.mnda.send")}
              </button>
            ) : null}
            <button className={styles.secondary} onClick={closePreview}>
              {t("common.close")}
            </button>
          </div>
        </section>
      ) : null}
      <section className={styles.panel}>
        <label>
          {t("common.search")}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {filtered.length === 0 ? (
          <p>{t("operations.mnda.none")}</p>
        ) : (
          <div className={styles.table}>
            <table>
              <caption>{t("operations.mnda.title")}</caption>
              <thead>
                <tr>
                  {[
                    "operations.mnda.company",
                    "common.status",
                    "operations.mnda.countersigner",
                    "operations.mnda.owner",
                    "operations.mnda.updated",
                    "common.actions",
                  ].map((k) => (
                    <th key={k}>{t(k as MessageId)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.input.company}</strong>
                      <br />
                      {r.input.signerEmail}
                    </td>
                    <td>
                      <span className={styles.state}>{t(states[r.state])}</span>
                      {r.error ? <p>{t("status.blocked")}</p> : null}
                    </td>
                    <td>{r.countersigner.name}</td>
                    <td>{r.ownerName}</td>
                    <td>{new Date(r.updatedAt).toLocaleString(locale)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void openRecord(
                              r,
                              r.state === "completed" ? "executed" : "original",
                            )
                          }
                        >
                          {t(
                            r.state === "completed"
                              ? "operations.mnda.executed"
                              : "operations.mnda.openPdf",
                          )}
                        </button>
                        {!terminal(r) && r.providerId ? (
                          <button
                            disabled={busy || !data.ready}
                            onClick={() => void operate(r, "sync")}
                          >
                            {t("common.refresh")}
                          </button>
                        ) : null}
                        {[
                          "sent",
                          "viewed",
                          "awaiting_countersignature",
                        ].includes(r.state) ? (
                          <button
                            disabled={busy || !data.ready}
                            onClick={() => void operate(r, "remind")}
                          >
                            {t("operations.mnda.remind")}
                          </button>
                        ) : null}
                        {!terminal(r) && !r.providerId ? (
                          <button
                            disabled={busy || !data.ready}
                            onClick={() => void operate(r, "cancel")}
                          >
                            {t("operations.mnda.cancel")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data.canManage ? (
        <section className={styles.panel}>
          <div className={styles.header}>
            <h2>{t("operations.mnda.signers")}</h2>
            <button
              className={styles.secondary}
              onClick={() =>
                setSigner({
                  id: crypto.randomUUID(),
                  name: "",
                  email: "",
                  title: "",
                  active: true,
                  isDefault: false,
                })
              }
            >
              {t("operations.mnda.newSigner")}
            </button>
          </div>
          {data.signers.map((s) => (
            <div key={s.id} className={styles.signer}>
              <span>
                {s.name} · {s.email} · {s.title}
                {s.isDefault ? ` · ${t("operations.mnda.default")}` : ""}
              </span>
              <button className={styles.secondary} onClick={() => setSigner(s)}>
                {t("common.edit")}
              </button>
            </div>
          ))}
          {signer ? (
            <form
              className={styles.fields}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await configureMndaSigner(signer);
                  setSigner(null);
                });
              }}
            >
              {(["name", "email", "title"] as const).map((field) => (
                <label key={field}>
                  {t(
                    field === "title"
                      ? "operations.mnda.titleField"
                      : field === "name"
                        ? "common.name"
                        : "common.email",
                  )}
                  <input
                    required
                    maxLength={field === "email" ? 254 : 180}
                    type={field === "email" ? "email" : "text"}
                    value={signer[field]}
                    onChange={(e) =>
                      setSigner({ ...signer, [field]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={signer.active}
                  onChange={(e) =>
                    setSigner({
                      ...signer,
                      active: e.target.checked,
                      isDefault: e.target.checked ? signer.isDefault : false,
                    })
                  }
                />
                {t("operations.mnda.active")}
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={signer.isDefault}
                  onChange={(e) =>
                    setSigner({
                      ...signer,
                      isDefault: e.target.checked,
                      active: e.target.checked ? true : signer.active,
                    })
                  }
                />
                {t("operations.mnda.default")}
              </label>
              <div className={styles.actions}>
                <button disabled={busy}>{t("common.save")}</button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setSigner(null)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
