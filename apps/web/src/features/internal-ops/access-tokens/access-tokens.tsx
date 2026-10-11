"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  accessTokenDefaultDays,
  accessTokenLive,
  type AccessTokenAdminRecord,
  type AccessTokenRecord,
} from "@clockwork/contracts";
import { Button, StateBanner } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import {
  createAccessToken,
  revokeOwnAccessToken,
  revokeStaffAccessToken,
} from "./actions";
import type {
  AccessTokenActionResult,
  OwnAccessTokensView,
  StaffAccessTokensView,
} from "./model";
import styles from "./access-tokens.module.css";

type Failure = Extract<AccessTokenActionResult, { ok: false }>;
const expiryChoices = [30, 90, 180, 365] as const;

const errorMessage = (code: Failure["code"]) =>
  `operations.accessTokens.error.${code}` as MessageId;

function TokenStatus({ token }: { token: AccessTokenRecord }) {
  const t = useTranslations();
  if (token.revokedAt)
    return (
      <span className={styles.ended}>
        {token.revokedReason
          ? t(
              `operations.accessTokens.status.revokedBy.${token.revokedReason}` as MessageId,
            )
          : t("operations.accessTokens.status.revoked")}
      </span>
    );
  if (!accessTokenLive(token))
    return (
      <span className={styles.ended}>
        {t("operations.accessTokens.status.expired")}
      </span>
    );
  return (
    <span className={styles.active}>
      {t("operations.accessTokens.status.active")}
    </span>
  );
}

function RevokeControl({
  token,
  revoke,
}: {
  token: AccessTokenRecord;
  revoke: (id: string) => Promise<AccessTokenActionResult>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<Failure["code"] | null>(null);
  const [pending, startTransition] = useTransition();
  if (!accessTokenLive(token)) return null;
  if (!confirming)
    return (
      <Button
        type="button"
        variant="secondary"
        aria-label={t("operations.accessTokens.revokeNamed", {
          name: token.name,
        })}
        onClick={() => setConfirming(true)}
      >
        {t("operations.accessTokens.revoke")}
      </Button>
    );
  return (
    <div className={styles.confirm} role="group">
      <p>{t("operations.accessTokens.revokeConfirm", { name: token.name })}</p>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await revoke(token.id).catch(
                (): AccessTokenActionResult => ({
                  ok: false,
                  code: "UNEXPECTED",
                }),
              );
              if (result.ok) {
                setConfirming(false);
                router.refresh();
              } else setFailure(result.code);
            })
          }
        >
          {t("operations.accessTokens.revokeYes")}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          {t("operations.accessTokens.cancel")}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className={styles.error}>
          {t(errorMessage(failure))}
        </p>
      ) : null}
    </div>
  );
}

function TokenTable({
  tokens,
  caption,
  revoke,
}: {
  tokens: readonly (AccessTokenRecord | AccessTokenAdminRecord)[];
  caption: string;
  revoke: (id: string) => Promise<AccessTokenActionResult>;
}) {
  const t = useTranslations();
  const showOwner = tokens.some((token) => "userName" in token);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {showOwner ? (
              <th scope="col">{t("operations.accessTokens.column.owner")}</th>
            ) : null}
            <th scope="col">{t("operations.accessTokens.column.name")}</th>
            <th scope="col">{t("operations.accessTokens.column.access")}</th>
            <th scope="col">{t("operations.accessTokens.column.created")}</th>
            <th scope="col">{t("operations.accessTokens.column.expires")}</th>
            <th scope="col">{t("operations.accessTokens.column.lastUsed")}</th>
            <th scope="col">{t("operations.accessTokens.column.status")}</th>
            <th scope="col">
              <span className="sr-only">
                {t("operations.accessTokens.column.actions")}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              {showOwner && "userName" in token ? (
                <td>
                  {token.userName}
                  <span className={styles.muted}>{token.userEmail}</span>
                </td>
              ) : null}
              <th scope="row">
                {token.name}
                <code className={styles.prefix}>{token.prefix}…</code>
              </th>
              <td>
                {t(
                  token.scope === "read"
                    ? "operations.accessTokens.scope.read"
                    : "operations.accessTokens.scope.readWrite",
                )}
              </td>
              <td>
                <LocalTimestamp value={token.createdAt} />
              </td>
              <td>
                <LocalTimestamp value={token.expiresAt} />
              </td>
              <td>
                {token.lastUsedAt ? (
                  <LocalTimestamp value={token.lastUsedAt} />
                ) : (
                  t("operations.accessTokens.neverUsed")
                )}
              </td>
              <td>
                <TokenStatus token={token} />
              </td>
              <td>
                <RevokeControl token={token} revoke={revoke} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {t(
        copied
          ? "operations.accessTokens.copied"
          : "operations.accessTokens.copy",
      )}
    </Button>
  );
}

/** The Settings page section: create, list and revoke your own tokens. */
export function AccessTokensSection({
  view,
  endpoint,
}: {
  view: OwnAccessTokensView;
  /** The MCP endpoint's absolute address, for the Claude Code command. */
  endpoint: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure["code"] | null>(null);
  const [created, setCreated] = useState<{
    record: AccessTokenRecord;
    secret: string;
  } | null>(null);

  if (view.mode !== "live")
    return (
      <section className={styles.panel} aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`}>{t("operations.accessTokens.title")}</h2>
        <p>
          {t(
            view.mode === "demo"
              ? "operations.accessTokens.demo"
              : "operations.accessTokens.unavailable",
          )}
        </p>
      </section>
    );

  const command = created
    ? `claude mcp add --transport http fil-one-commerce ${endpoint} --header "Authorization: Bearer ${created.secret}"`
    : "";

  return (
    <section className={styles.panel} aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`}>{t("operations.accessTokens.title")}</h2>
      <p>{t("operations.accessTokens.description")}</p>

      {created ? (
        <div className={styles.created}>
          <StateBanner
            tone="success"
            live="polite"
            title={t("operations.accessTokens.created.title")}
            description={t("operations.accessTokens.created.description")}
          />
          <label htmlFor={`${formId}-secret`}>
            {t("operations.accessTokens.created.secret")}
          </label>
          <div className={styles.copyRow}>
            <input
              id={`${formId}-secret`}
              readOnly
              value={created.secret}
              className={styles.secret}
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={created.secret} />
          </div>
          <label htmlFor={`${formId}-command`}>
            {t("operations.accessTokens.created.command")}
          </label>
          <div className={styles.copyRow}>
            <textarea
              id={`${formId}-command`}
              readOnly
              rows={3}
              value={command}
              className={styles.secret}
            />
            <CopyButton value={command} />
          </div>
          <div className={styles.actions}>
            <Button type="button" onClick={() => setCreated(null)}>
              {t("operations.accessTokens.done")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const name = form.get("name");
            setFailure(null);
            startTransition(async () => {
              const result = await createAccessToken({
                name: typeof name === "string" ? name : "",
                scope: form.get("scope") === "read" ? "read" : "read_write",
                expiresInDays: Number(form.get("expiresInDays")),
              }).catch((): Extract<AccessTokenActionResult, { ok: false }> => ({
                ok: false,
                code: "UNEXPECTED",
              }));
              if (result.ok) {
                setCreated(result.value);
                router.refresh();
              } else setFailure(result.code);
            });
          }}
        >
          {!view.recentlyVerified ? (
            <p className={styles.note}>
              {t("operations.accessTokens.verify")}{" "}
              <Link href="/access/mfa">
                {t("operations.accessTokens.verifyAction")}
              </Link>
            </p>
          ) : null}
          <label htmlFor={`${formId}-name`}>
            {t("operations.accessTokens.name")}
          </label>
          <input
            id={`${formId}-name`}
            name="name"
            required
            maxLength={100}
            aria-describedby={`${formId}-name-help`}
          />
          <p id={`${formId}-name-help`} className={styles.note}>
            {t("operations.accessTokens.nameHelp")}
          </p>
          <fieldset className={styles.choices}>
            <legend>{t("operations.accessTokens.scope")}</legend>
            <label>
              <input type="radio" name="scope" value="read" />{" "}
              {t("operations.accessTokens.scope.read")}
              <span className={styles.muted}>
                {t("operations.accessTokens.scope.readHelp")}
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="scope"
                value="read_write"
                defaultChecked
              />{" "}
              {t("operations.accessTokens.scope.readWrite")}
              <span className={styles.muted}>
                {t("operations.accessTokens.scope.readWriteHelp")}
              </span>
            </label>
          </fieldset>
          <label htmlFor={`${formId}-expiry`}>
            {t("operations.accessTokens.expiry")}
          </label>
          <select
            id={`${formId}-expiry`}
            name="expiresInDays"
            defaultValue={String(accessTokenDefaultDays)}
          >
            {expiryChoices.map((days) => (
              <option key={days} value={days}>
                {t("operations.accessTokens.expiry.days", { days })}
              </option>
            ))}
          </select>
          <div className={styles.actions}>
            <Button type="submit" disabled={pending}>
              {t(
                pending
                  ? "operations.accessTokens.creating"
                  : "operations.accessTokens.create",
              )}
            </Button>
          </div>
          {failure ? (
            <p role="alert" className={styles.error}>
              {t(errorMessage(failure))}{" "}
              {failure === "RECENT_SIGN_IN_REQUIRED" ? (
                <Link href="/access/mfa">
                  {t("operations.accessTokens.verifyAction")}
                </Link>
              ) : null}
            </p>
          ) : null}
        </form>
      )}

      {view.tokens.length ? (
        <TokenTable
          tokens={view.tokens}
          caption={t("operations.accessTokens.list")}
          revoke={(id) => revokeOwnAccessToken({ id })}
        />
      ) : (
        <p>{t("operations.accessTokens.empty")}</p>
      )}
    </section>
  );
}

/** The Team page section: every staff member's tokens, for administrators. */
export function StaffAccessTokens({ view }: { view: StaffAccessTokensView }) {
  const t = useTranslations();
  if (view.mode !== "live") return null;
  return (
    <section className={styles.panel} aria-labelledby="team-access-tokens">
      <h2 id="team-access-tokens">{t("operations.accessTokens.team.title")}</h2>
      <p>{t("operations.accessTokens.team.description")}</p>
      {view.tokens.length ? (
        <TokenTable
          tokens={view.tokens}
          caption={t("operations.accessTokens.team.title")}
          revoke={(id) => revokeStaffAccessToken({ id })}
        />
      ) : (
        <p>{t("operations.accessTokens.team.empty")}</p>
      )}
    </section>
  );
}
