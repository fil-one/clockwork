"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  mndaExportLimit,
  mndaRegisterSearchParams,
  mndaVoidableStates,
  mndaPartnerLegalName,
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
  PageHeader,
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
import {
  mndaErrorLabels,
  mndaGroupLabels,
  mndaRecordStateLabel,
} from "./labels";
import { mndaDaysOutstanding, mndaPdfHref } from "./register";
import {
  BlockedButton,
  primaryRowAction,
  RowActionMenu,
  type MndaRowAction,
} from "./row-actions";
import { SessionExpiredReload, useSessionRefresh } from "../session-expiry";
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
      next: "operations.mnda.note.signersMismatchNext",
    };
  if (r.state === "attention" && r.error === "signwell_signed_mismatch")
    return {
      reason: "operations.mnda.note.signedMismatch",
      next: "operations.mnda.note.signedMismatchNext",
    };
  if (r.state === "attention" && r.error === "signwell_fields_mismatch")
    return {
      reason: "operations.mnda.note.fieldsMismatch",
      next: "operations.mnda.note.fieldsMismatchNext",
    };
  if (
    r.state === "attention" &&
    r.error === "signwell_copied_contacts_mismatch"
  )
    return {
      reason: "operations.mnda.note.copiedContactsMismatch",
      next: "operations.mnda.note.fieldsMismatchNext",
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
  compose = false,
}: {
  initial: MndaWorkspaceData;
  initialQuery: MndaRegisterQuery;
  /** Open a new MNDA on arrival. */
  compose?: boolean;
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
    expired?: boolean;
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
  const refreshSession = useSessionRefresh();

  const reload = useCallback(
    async (next: MndaRegisterQuery, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        // Refreshes re-read only the register.
        const load = quiet ? loadMndaRegister : loadMndas;
        let result = await load(next);
        // Reads are safe to repeat once a navigation has refreshed the session.
        if (!result.ok && result.code === "session_expired") {
          await refreshSession();
          result = await load(next);
        }
        if (next !== queryRef.current) return;
        if (result.ok) {
          const value = result.value;
          setData((current) => ({ ...current, ...value }));
          setLoadFailed(false);
        } else if (!quiet) setLoadFailed(true);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [refreshSession],
  );
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
  const startNew = () =>
    open({ kind: "form", values: emptyValues(data.signers) });
  // `?compose=1` (the home page and the command palette) opens a new MNDA.
  // The flag leaves the URL so a reload or a filter change does not reopen it.
  useEffect(() => {
    if (!compose) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("compose");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    if (!initial.demo)
      open({ kind: "form", values: emptyValues(initial.signers) });
    // Once, on arrival.
  }, []);
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
        setMessage({
          tone: "danger",
          text: t(mndaErrorLabels[result.code]),
          expired: result.code === "session_expired",
        });
        return false;
      }
      // Named from SignWell's state as the reminder found it, not the row.
      if (operation === "remind")
        setMessage({
          tone: "success",
          text: t("operations.mnda.reminded", {
            name:
              result.value.state === "awaiting_countersignature"
                ? result.value.countersigner.name
                : result.value.input.signerName,
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
  // Why a control cannot act. The demo refuses every change; without the
  // signing connection, anything that reaches SignWell waits.
  const demoBlock = data.demo ? t("operations.mnda.blocked.demo") : null;
  const sendBlock =
    demoBlock ?? (data.ready ? null : t("operations.mnda.blocked.notReady"));

  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.mnda.title")}
        description={t("operations.mnda.description")}
        actions={
          <>
            {demoBlock ? (
              <BlockedButton reason={demoBlock} variant="primary" size="medium">
                {t("operations.mnda.new")}
              </BlockedButton>
            ) : (
              <Button onClick={startNew}>{t("operations.mnda.new")}</Button>
            )}
            <a
              className={buttonClassName({ variant: "secondary" })}
              href={`/internal/mndas/export${exportParams ? `?${exportParams}` : ""}`}
              download
            >
              {t("operations.mnda.export")}
            </a>
            {data.canManage ? (
              <a
                className={buttonClassName({ variant: "quiet" })}
                href="/internal/mndas/settings"
              >
                {t("operations.mnda.settings.link")}
              </a>
            ) : null}
          </>
        }
      />
      {data.demo ? (
        <StateBanner tone="info" title={t("operations.mnda.demo")} />
      ) : !data.ready ? (
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
          {...(message.expired
            ? {
                action: (
                  <SessionExpiredReload onReloaded={() => setMessage(null)} />
                ),
              }
            : {})}
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
                  <th scope="col" className={styles.companyColumn}>
                    {t("operations.mnda.column.company")}
                  </th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("operations.mnda.countersigner")}</th>
                  <th scope="col">{t("operations.mnda.column.sent")}</th>
                  <th scope="col">{t("operations.mnda.column.waiting")}</th>
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
                  // Someone signed SignWell's copy: resolved in SignWell.
                  const voidable =
                    mine &&
                    bound &&
                    mndaVoidableStates.includes(r.state) &&
                    r.error !== "signwell_signed_mismatch";
                  // A stopped request needs a void; only a bounce is fixed in place.
                  const correctable =
                    mine &&
                    bound &&
                    (["sent", "viewed"].includes(r.state) ||
                      (r.state === "attention" &&
                        (r.error === "recipient_bounced" ||
                          r.error === "signwell_signers_mismatch")));
                  const signedAs = mndaPartnerLegalName(r);
                  const email = mndaSignerEmail(r);
                  const primary = primaryRowAction(r, { bound, correctable });
                  const variant = (action: MndaRowAction) =>
                    action === primary ? "secondary" : "quiet";
                  const openPdf =
                    r.state === "completed" ? null : (
                      <a
                        className={buttonClassName({
                          variant: variant("openPdf"),
                          size: "small",
                        })}
                        href={mndaPdfHref(r.id, "original")}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("operations.mnda.openPdf")}
                      </a>
                    );
                  const signedPdf =
                    r.state === "completed" ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "small",
                        })}
                        href={mndaPdfHref(r.id, "executed", true)}
                      >
                        {t("operations.mnda.executed")}
                      </a>
                    ) : null;
                  const recordContract =
                    r.state === "completed" && data.canRecordContracts ? (
                      <a
                        className={buttonClassName({
                          variant: "quiet",
                          size: "small",
                        })}
                        href={`/internal/contracts/new?mnda=${r.id}`}
                      >
                        {t("operations.contracts.action.record")}
                      </a>
                    ) : null;
                  const continueDraft = !unsentStates.includes(
                    r.state,
                  ) ? null : demoBlock ? (
                    <BlockedButton
                      reason={demoBlock}
                      variant={variant("continue")}
                    >
                      {t("operations.mnda.continue")}
                    </BlockedButton>
                  ) : (
                    <Button
                      variant={variant("continue")}
                      size="small"
                      disabled={busy}
                      onClick={() => open({ kind: "preview", record: r })}
                    >
                      {t("operations.mnda.continue")}
                    </Button>
                  );
                  const remindLabel = t("operations.mnda.remindName", {
                    name:
                      r.state === "awaiting_countersignature"
                        ? r.countersigner.name
                        : r.input.signerName,
                  });
                  const remind = ![
                    "sent",
                    "viewed",
                    "awaiting_countersignature",
                  ].includes(r.state) ? null : sendBlock ? (
                    <BlockedButton
                      reason={sendBlock}
                      variant={variant("remind")}
                    >
                      {remindLabel}
                    </BlockedButton>
                  ) : (
                    <Button
                      variant={variant("remind")}
                      size="small"
                      disabled={busy}
                      onClick={() => void operate(r, "remind")}
                    >
                      {remindLabel}
                    </Button>
                  );
                  const fixEmail = !correctable ? null : sendBlock ? (
                    <BlockedButton
                      reason={sendBlock}
                      variant={variant("fixEmail")}
                    >
                      {t("operations.mnda.fixEmail")}
                    </BlockedButton>
                  ) : (
                    <CorrectSignerDialog
                      record={r}
                      trigger={
                        <Button
                          variant={variant("fixEmail")}
                          size="small"
                          disabled={busy}
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
                  );
                  const checkStatus = !(
                    bound && !terminal(r)
                  ) ? null : sendBlock ? (
                    <BlockedButton
                      reason={sendBlock}
                      variant={variant("checkStatus")}
                    >
                      {t("operations.mnda.checkStatus")}
                    </BlockedButton>
                  ) : (
                    <Button
                      variant={variant("checkStatus")}
                      size="small"
                      disabled={busy}
                      onClick={() => void operate(r, "sync")}
                    >
                      {t("operations.mnda.checkStatus")}
                    </Button>
                  );
                  const copy = !(
                    r.state !== "canceled" || bound
                  ) ? null : demoBlock ? (
                    <BlockedButton reason={demoBlock} variant={variant("copy")}>
                      {t("operations.mnda.copy")}
                    </BlockedButton>
                  ) : (
                    <Button
                      variant={variant("copy")}
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
                      {t("operations.mnda.copy")}
                    </Button>
                  );
                  const voidAction = !voidable ? null : sendBlock ? (
                    <BlockedButton
                      reason={sendBlock}
                      className={styles.destructiveAction}
                    >
                      {t("operations.mnda.void.action")}
                    </BlockedButton>
                  ) : (
                    <VoidDialog
                      record={r}
                      open={resendAfterVoid?.id === r.id ? true : undefined}
                      onOpenChange={(next) => {
                        if (!next) setResendAfterVoid(null);
                      }}
                      signerChange={resendAfterVoid?.id === r.id}
                      trigger={
                        <Button
                          variant="quiet"
                          size="small"
                          className={styles.destructiveAction}
                          disabled={busy}
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
                            values: valuesFromRecord(record, data.signers, {
                              keepDate: false,
                              clearSigner: true,
                            }),
                          });
                        else
                          setMessage({
                            tone: "success",
                            text: t("operations.mnda.voidedMessage"),
                          });
                      }}
                    />
                  );
                  const discard = !(
                    mine &&
                    !bound &&
                    !terminal(r)
                  ) ? null : demoBlock ? (
                    <BlockedButton
                      reason={demoBlock}
                      className={styles.destructiveAction}
                    >
                      {t("operations.mnda.discardDraft")}
                    </BlockedButton>
                  ) : (
                    <DiscardDialog
                      record={r}
                      trigger={
                        <Button
                          variant="quiet"
                          size="small"
                          className={styles.destructiveAction}
                          disabled={busy}
                        >
                          {t("operations.mnda.discardDraft")}
                        </Button>
                      }
                      onConfirm={() => operate(r, "cancel")}
                    />
                  );
                  const actions: Record<MndaRowAction, ReactNode> = {
                    continue: continueDraft,
                    remind,
                    fixEmail,
                    checkStatus,
                    signedPdf,
                    copy,
                    openPdf,
                  };
                  const others = (
                    [
                      "openPdf",
                      "continue",
                      "remind",
                      "fixEmail",
                      "checkStatus",
                      "copy",
                    ] as const
                  )
                    .filter((action) => action !== primary)
                    .map((action) => actions[action]);
                  return (
                    <tr key={r.id}>
                      <td
                        className={styles.companyColumn}
                        data-label={t("operations.mnda.column.company")}
                      >
                        <strong className={styles.company}>
                          {r.input.company}
                        </strong>
                        {signedAs &&
                        signedAs.toLowerCase() !==
                          r.input.company.trim().toLowerCase() ? (
                          <span className={styles.muted}>
                            {t("operations.mnda.signedAs", { name: signedAs })}
                          </span>
                        ) : null}
                        <span className={styles.muted}>
                          {r.input.signerName}
                        </span>
                        <span className={styles.email} title={email}>
                          {email}
                        </span>
                      </td>
                      <td data-label={t("common.status")}>
                        <div>
                          <StatusBadge tone={tones[r.state] ?? "neutral"}>
                            {t(mndaRecordStateLabel(r))}
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
                        <div>
                          {r.countersigner.name}
                          <span className={styles.muted}>
                            {t("operations.mnda.preparedBy", {
                              name: r.ownerName,
                            })}
                          </span>
                        </div>
                      </td>
                      <td
                        className={styles.date}
                        data-label={t("operations.mnda.column.sent")}
                      >
                        {r.sentAt
                          ? formatMndaDate(r.sentAt, locale)
                          : t("operations.mnda.notSent")}
                      </td>
                      <td data-label={t("operations.mnda.column.waiting")}>
                        {days !== null
                          ? t("operations.mnda.days", { count: days })
                          : r.state === "completed" && r.completedAt
                            ? t("operations.mnda.completedOn", {
                                date: formatMndaDate(r.completedAt, locale),
                              })
                            : "–"}
                      </td>
                      <td data-label={t("common.actions")}>
                        <RowActionMenu
                          company={r.input.company}
                          primary={actions[primary]}
                          more={[recordContract, ...others]}
                          destructive={[voidAction, discard]}
                        />
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
