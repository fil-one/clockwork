"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  mndaExportLimit,
  mndaRegisterSearchParams,
  mndaVoidableStates,
  mndaSignerEmail,
  mndaStatusGroups,
  type MndaRecord,
  type MndaRegisterQuery,
  type MndaState,
  type MndaStatusGroup,
} from "@clockwork/contracts";
import {
  Button,
  buttonClassName,
  Checkbox,
  EmptyState,
  StateBanner,
  StatusBadge,
} from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import {
  loadMndaRegister,
  loadMndas,
  operateMnda,
  type MndaWorkspaceData,
} from "./actions";
import { MndaComposer, type ComposerStart } from "./composer";
import { CorrectSignerDialog, DiscardDialog, VoidDialog } from "./dialogs";
import { emptyValues, valuesFromRecord } from "./form-model";
import { formatMndaDate } from "./format";
import { mndaErrorLabels, mndaGroupLabels, mndaStateLabels } from "./labels";
import { mndaDaysOutstanding, mndaPdfHref } from "./register";
import styles from "./workspace.module.css";

const terminal = (r: MndaRecord) =>
  ["completed", "declined", "expired", "canceled"].includes(r.state);
const unsentStates: readonly MndaState[] = [
  "draft",
  "preparing",
  "ready",
  "sending",
];
const tones: Partial<
  Record<MndaState, "neutral" | "info" | "success" | "warning" | "danger">
> = {
  sent: "info",
  viewed: "info",
  awaiting_countersignature: "warning",
  completed: "success",
  attention: "danger",
};
const groups = Object.keys(mndaStatusGroups) as MndaStatusGroup[];
function activeGroup(status: readonly MndaState[]): MndaStatusGroup | null {
  return (
    groups.find((group) => {
      const states: readonly MndaState[] = mndaStatusGroups[group];
      return (
        states.length === status.length &&
        states.every((s) => status.includes(s))
      );
    }) ?? null
  );
}

/** Why a request needs someone, and what to do next, in plain words. */
function rowNote(
  r: MndaRecord,
): { reason: MessageId; next?: MessageId } | null {
  if (r.state === "canceled") {
    if (r.cancelCode === "superseded")
      return { reason: "operations.mnda.note.superseded" };
    if (r.cancelCode === "discarded")
      return { reason: "operations.mnda.note.discarded" };
    if (r.cancelCode === "signer_change")
      return { reason: "operations.mnda.note.signerChange" };
    return null;
  }
  if (r.state === "attention" && r.error === "deleted_in_signwell")
    return {
      reason: "operations.mnda.note.deletedInSignWell",
      next: "operations.mnda.note.deletedNext",
    };
  if (r.state === "attention" && r.error === "signwell_signers_mismatch")
    return {
      reason: "operations.mnda.note.signersMismatch",
      next: "operations.mnda.note.stoppedNext",
    };
  if (r.state === "attention" && r.error === "signwell_binding_mismatch")
    return {
      reason: "operations.mnda.note.bindingMismatch",
      next: "operations.mnda.note.stoppedNext",
    };
  if (r.state === "attention")
    return r.error === "recipient_bounced"
      ? {
          reason: "operations.mnda.note.bounced",
          next: "operations.mnda.note.bouncedNext",
        }
      : {
          reason: "operations.mnda.note.stopped",
          next: "operations.mnda.note.stoppedNext",
        };
  if (r.error === "provider_unavailable")
    return unsentStates.includes(r.state)
      ? {
          reason: "operations.mnda.note.sendUnfinished",
          next: "operations.mnda.note.sendUnfinishedNext",
        }
      : {
          reason: "operations.mnda.note.unreachable",
          next: "operations.mnda.note.unreachableNext",
        };
  if (r.state === "expired")
    return {
      reason: "operations.mnda.note.expired",
      next: "operations.mnda.note.sendAgainNext",
    };
  if (r.state === "declined")
    return {
      reason: "operations.mnda.note.declined",
      next: "operations.mnda.note.sendAgainNext",
    };
  return null;
}

export function MndaWorkspace({
  initial,
  initialQuery,
}: {
  initial: MndaWorkspaceData;
  initialQuery: MndaRegisterQuery;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.q);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [composer, setComposer] = useState<{
    key: number;
    start: ComposerStart;
  } | null>(null);
  const [resendAfterVoid, setResendAfterVoid] = useState<MndaRecord | null>(
    null,
  );
  const queryRef = useRef(query);
  queryRef.current = query;
  const composerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async (next: MndaRegisterQuery, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // Refreshes re-read only the register.
      const result = quiet
        ? await loadMndaRegister(next)
        : await loadMndas(next);
      if (next !== queryRef.current) return;
      if (result.ok) {
        const value = result.value;
        setData((current) => ({ ...current, ...value }));
        setLoadFailed(false);
      } else if (!quiet) setLoadFailed(true);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);
  const changeQuery = (patch: Partial<MndaRegisterQuery>) => {
    const next = { ...queryRef.current, page: 1, ...patch };
    setQuery(next);
    queryRef.current = next;
    const params = mndaRegisterSearchParams(next).toString();
    window.history.replaceState(
      null,
      "",
      params
        ? `${window.location.pathname}?${params}`
        : window.location.pathname,
    );
    void reload(next);
  };
  // Debounced search keeps typing responsive.
  useEffect(() => {
    if (search === queryRef.current.q) return;
    const timer = setTimeout(() => changeQuery({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
    // changeQuery reads the latest query through a ref, so only `search` matters.
  }, [search]);
  // Provider callbacks update the register; refresh while the tab is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void reload(queryRef.current, true);
    }, 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  const open = (start: ComposerStart) => {
    setMessage(null);
    setComposer((current) => ({ key: (current?.key ?? 0) + 1, start }));
    requestAnimationFrame(() =>
      composerRef.current?.scrollIntoView?.({ block: "start" }),
    );
  };
  const refresh = () => void reload(queryRef.current, true);
  async function operate(
    record: MndaRecord,
    operation: "sync" | "remind" | "cancel",
  ): Promise<boolean> {
    setRowBusy(record.id);
    setMessage(null);
    try {
      const result = await operateMnda({ id: record.id, operation });
      if (!result.ok) {
        setMessage({ tone: "danger", text: t(mndaErrorLabels[result.code]) });
        return false;
      }
      if (operation === "remind")
        setMessage({
          tone: "success",
          text: t("operations.mnda.reminded", {
            name:
              record.state === "awaiting_countersignature"
                ? record.countersigner.name
                : record.input.signerName,
          }),
        });
      return true;
    } finally {
      setRowBusy(null);
      refresh();
    }
  }

  const { records, total, page, pageSize } = data.register;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = query.status.length > 0 || query.mine || query.q !== "";
  const group = activeGroup(query.status);
  const exportParams = mndaRegisterSearchParams({
    status: query.status,
    mine: query.mine,
    q: query.q,
  }).toString();

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <h1>{t("operations.mnda.title")}</h1>
          <p className={styles.muted}>{t("operations.mnda.description")}</p>
        </div>
        <div className={styles.headerActions}>
          {data.canManage ? (
            <a
              className={buttonClassName({ variant: "quiet" })}
              href="/internal/mndas/settings"
            >
              {t("operations.mnda.settings.link")}
            </a>
          ) : null}
          <a
            className={buttonClassName({ variant: "secondary" })}
            href={`/internal/mndas/export${exportParams ? `?${exportParams}` : ""}`}
            download
          >
            {t("operations.mnda.export")}
          </a>
          <Button
            onClick={() =>
              open({ kind: "form", values: emptyValues(data.signers) })
            }
          >
            {t("operations.mnda.new")}
          </Button>
        </div>
      </header>
      {!data.ready ? (
        <StateBanner tone="warning" title={t("operations.mnda.notReady")} />
      ) : null}
      {data.testMode ? (
        <StateBanner tone="info" title={t("operations.mnda.testMode")} />
      ) : null}
      {message ? (
        <StateBanner
          tone={message.tone}
          live={message.tone === "danger" ? "assertive" : "polite"}
          title={message.text}
          dismiss={
            <Button
              variant="quiet"
              size="small"
              onClick={() => setMessage(null)}
            >
              {t("operations.mnda.dismiss")}
            </Button>
          }
        />
      ) : null}
      <div ref={composerRef}>
        {composer ? (
          <MndaComposer
            key={composer.key}
            start={composer.start}
            signers={data.signers}
            noticeEmail={data.noticeEmail}
            ready={data.ready}
            canEdit={(record) =>
              data.canManage || record.ownerId === data.viewerId
            }
            onClose={() => setComposer(null)}
            onChanged={refresh}
            onSent={(record) => {
              setComposer(null);
              setMessage({
                tone: "success",
                text: t("operations.mnda.sentMessage", {
                  email: mndaSignerEmail(record),
                }),
              });
              refresh();
            }}
          />
        ) : null}
      </div>
      <section className={styles.panel} aria-labelledby="mnda-register-heading">
        <div className={styles.registerHeader}>
          <h2 id="mnda-register-heading">{t("operations.mnda.register")}</h2>
          <p className={styles.muted} role="status" aria-live="polite">
            {loading
              ? t("operations.mnda.loading")
              : t("operations.mnda.count", { count: total })}
          </p>
        </div>
        {total > mndaExportLimit ? (
          <p className={styles.muted}>
            {t("operations.mnda.exportTruncated", {
              limit: mndaExportLimit.toLocaleString(locale),
            })}
          </p>
        ) : null}
        <div className={styles.toolbar} role="search">
          <label className={styles.search}>
            <span className={styles.srOnly}>
              {t("operations.mnda.searchLabel")}
            </span>
            <input
              type="search"
              value={search}
              placeholder={t("operations.mnda.searchPlaceholder")}
              maxLength={120}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Checkbox
            label={t("operations.mnda.mine")}
            checked={query.mine}
            onChange={(e) => changeQuery({ mine: e.target.checked })}
          />
        </div>
        <div
          className={styles.chips}
          role="group"
          aria-label={t("operations.mnda.statusFilter")}
        >
          <button
            type="button"
            className={styles.chip}
            aria-pressed={query.status.length === 0}
            onClick={() => changeQuery({ status: [] })}
          >
            {t("operations.mnda.group.all")}
          </button>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={styles.chip}
              aria-pressed={group === g}
              onClick={() => changeQuery({ status: [...mndaStatusGroups[g]] })}
            >
              {t(mndaGroupLabels[g])}
            </button>
          ))}
        </div>
        {loadFailed ? (
          <StateBanner
            tone="danger"
            title={t("operations.mnda.loadFailed")}
            action={
              <Button
                variant="secondary"
                size="small"
                onClick={() => void reload(queryRef.current)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}
        {records.length === 0 && !loading ? (
          filtered ? (
            <EmptyState
              title={t("operations.mnda.noMatches")}
              description={t("operations.mnda.noMatchesHint")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    changeQuery({ status: [], mine: false, q: "" });
                  }}
                >
                  {t("operations.mnda.clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t("operations.mnda.none")}
              description={t("operations.mnda.noneHint")}
            />
          )
        ) : (
          <div className={styles.table} aria-busy={loading || undefined}>
            <table>
              <caption className={styles.srOnly}>
                {t("operations.mnda.register")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("operations.mnda.column.company")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("operations.mnda.countersigner")}</th>
                  <th scope="col">{t("operations.mnda.owner")}</th>
                  <th scope="col">{t("operations.mnda.column.sent")}</th>
                  <th scope="col">{t("operations.mnda.column.outstanding")}</th>
                  <th scope="col">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const note = rowNote(r);
                  const days = mndaDaysOutstanding(r);
                  const busy = rowBusy === r.id;
                  const bound = Boolean(r.providerId);
                  // Voiding, discarding and fixing the email belong to the
                  // preparer or a signatory manager; anyone may remind.
                  const mine = data.canManage || r.ownerId === data.viewerId;
                  const voidable =
                    mine && bound && mndaVoidableStates.includes(r.state);
                  // A stopped request needs a void; only a bounce is fixed in place.
                  const correctable =
                    mine &&
                    bound &&
                    (["sent", "viewed"].includes(r.state) ||
                      (r.state === "attention" &&
                        r.error === "recipient_bounced"));
                  return (
                    <tr key={r.id}>
                      <td data-label={t("operations.mnda.column.company")}>
                        <strong className={styles.company}>
                          {r.input.company}
                        </strong>
                        <span className={styles.muted}>
                          {r.input.signerName} · {mndaSignerEmail(r)}
                        </span>
                      </td>
                      <td data-label={t("common.status")}>
                        <div>
                          <StatusBadge tone={tones[r.state] ?? "neutral"}>
                            {t(mndaStateLabels[r.state])}
                          </StatusBadge>
                          {r.testMode ? (
                            <span className={styles.testMark}>
                              {t("operations.mnda.testBadge")}
                            </span>
                          ) : null}
                          {note ? (
                            <p className={styles.note}>
                              {t(note.reason)}
                              {note.next ? <> {t(note.next)}</> : null}
                            </p>
                          ) : null}
                          {r.state === "canceled" && r.cancelReason ? (
                            <p className={styles.note}>
                              {t("operations.mnda.note.voided", {
                                reason: r.cancelReason,
                              })}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td data-label={t("operations.mnda.countersigner")}>
                        {r.countersigner.name}
                      </td>
                      <td data-label={t("operations.mnda.owner")}>
                        {r.ownerName}
                      </td>
                      <td
                        className={styles.date}
                        data-label={t("operations.mnda.column.sent")}
                      >
                        {r.sentAt
                          ? formatMndaDate(r.sentAt, locale)
                          : t("operations.mnda.notSent")}
                      </td>
                      <td data-label={t("operations.mnda.column.outstanding")}>
                        {days === null
                          ? r.completedAt
                            ? t("operations.mnda.completedOn", {
                                date: formatMndaDate(r.completedAt, locale),
                              })
                            : "–"
                          : t("operations.mnda.days", { count: days })}
                      </td>
                      <td data-label={t("common.actions")}>
                        <div className={styles.rowActions}>
                          {r.state === "completed" ? (
                            <a
                              className={buttonClassName({
                                variant: "secondary",
                                size: "small",
                              })}
                              href={mndaPdfHref(r.id, "executed", true)}
                            >
                              {t("operations.mnda.executed")}
                            </a>
                          ) : (
                            <a
                              className={buttonClassName({
                                variant: "quiet",
                                size: "small",
                              })}
                              href={mndaPdfHref(r.id, "original")}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("operations.mnda.openPdf")}
                            </a>
                          )}
                          {unsentStates.includes(r.state) ? (
                            <Button
                              variant="secondary"
                              size="small"
                              disabled={busy}
                              onClick={() =>
                                open({ kind: "preview", record: r })
                              }
                            >
                              {t("operations.mnda.continue")}
                            </Button>
                          ) : null}
                          {[
                            "sent",
                            "viewed",
                            "awaiting_countersignature",
                          ].includes(r.state) ? (
                            <Button
                              variant="secondary"
                              size="small"
                              disabled={busy || !data.ready}
                              onClick={() => void operate(r, "remind")}
                            >
                              {t("operations.mnda.remindName", {
                                name:
                                  r.state === "awaiting_countersignature"
                                    ? r.countersigner.name
                                    : r.input.signerName,
                              })}
                            </Button>
                          ) : null}
                          {correctable ? (
                            <CorrectSignerDialog
                              record={r}
                              trigger={
                                <Button
                                  variant="quiet"
                                  size="small"
                                  disabled={busy || !data.ready}
                                >
                                  {t("operations.mnda.fixEmail")}
                                </Button>
                              }
                              onDone={(record) => {
                                setMessage({
                                  tone: "success",
                                  text: t("operations.mnda.correctedMessage", {
                                    email: mndaSignerEmail(record),
                                  }),
                                });
                                refresh();
                              }}
                              onSendToSomeoneElse={() => setResendAfterVoid(r)}
                            />
                          ) : null}
                          {voidable ? (
                            <VoidDialog
                              record={r}
                              open={
                                resendAfterVoid?.id === r.id ? true : undefined
                              }
                              onOpenChange={(next) => {
                                if (!next) setResendAfterVoid(null);
                              }}
                              signerChange={resendAfterVoid?.id === r.id}
                              trigger={
                                <Button
                                  variant="quiet"
                                  size="small"
                                  disabled={busy || !data.ready}
                                >
                                  {t("operations.mnda.void.action")}
                                </Button>
                              }
                              onDone={(record) => {
                                const resend = resendAfterVoid?.id === r.id;
                                setResendAfterVoid(null);
                                refresh();
                                if (resend)
                                  open({
                                    kind: "form",
                                    values: valuesFromRecord(
                                      record,
                                      data.signers,
                                      {
                                        keepDate: false,
                                        clearSigner: true,
                                      },
                                    ),
                                  });
                                else
                                  setMessage({
                                    tone: "success",
                                    text: t("operations.mnda.voidedMessage"),
                                  });
                              }}
                            />
                          ) : null}
                          {mine && !bound && !terminal(r) ? (
                            <DiscardDialog
                              record={r}
                              trigger={
                                <Button
                                  variant="quiet"
                                  size="small"
                                  disabled={busy}
                                >
                                  {t("operations.mnda.discardDraft")}
                                </Button>
                              }
                              onConfirm={() => operate(r, "cancel")}
                            />
                          ) : null}
                          {bound && !terminal(r) ? (
                            <Button
                              variant="quiet"
                              size="small"
                              disabled={busy || !data.ready}
                              onClick={() => void operate(r, "sync")}
                            >
                              {t("common.refresh")}
                            </Button>
                          ) : null}
                          {r.state !== "canceled" || bound ? (
                            <Button
                              variant="quiet"
                              size="small"
                              onClick={() =>
                                open({
                                  kind: "form",
                                  values: valuesFromRecord(r, data.signers, {
                                    keepDate: false,
                                  }),
                                })
                              }
                            >
                              {t(
                                terminal(r)
                                  ? "operations.mnda.sendAgain"
                                  : "operations.mnda.duplicateAction",
                              )}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > pageSize ? (
          <nav
            className={styles.pagination}
            aria-label={t("operations.mnda.pagination")}
          >
            <Button
              variant="secondary"
              size="small"
              disabled={page <= 1 || loading}
              onClick={() => changeQuery({ page: page - 1 })}
            >
              {t("operations.mnda.previous")}
            </Button>
            <span>{t("operations.mnda.pageOf", { page, pages })}</span>
            <Button
              variant="secondary"
              size="small"
              disabled={page >= pages || loading}
              onClick={() => changeQuery({ page: page + 1 })}
            >
              {t("operations.mnda.next")}
            </Button>
          </nav>
        ) : null}
      </section>
    </main>
  );
}
