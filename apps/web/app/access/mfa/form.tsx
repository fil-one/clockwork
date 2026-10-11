"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";

export function MfaForm({
  returnTo,
  error,
}: {
  returnTo?: string | undefined;
  error?: string | undefined;
}) {
  const t = useTranslations();
  const preparation = useRef<Promise<Response> | null>(null);
  const submitting = useRef(false);
  const [proof, setProof] = useState("");
  const [problem, setProblem] = useState(error);
  const [preparing, setPreparing] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Share the request across Strict Mode's effect replay, not across mounts
    // or sessions. A link prefetch/server render never creates a challenge.
    preparation.current ??= fetch("/access/mfa/prepare", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(20_000),
    });
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void preparation.current
      .then(async (response) => {
        const value: unknown = await response.clone().json();
        if (!active) return;
        if (!value || typeof value !== "object")
          throw new Error("Invalid preparation");
        if (
          !response.ok ||
          !("proof" in value) ||
          typeof value.proof !== "string" ||
          !("validForMs" in value) ||
          typeof value.validForMs !== "number" ||
          value.validForMs <= 0 ||
          value.validForMs > 300_000
        ) {
          setProblem(
            "error" in value && value.error === "limited"
              ? "limited"
              : "error" in value && value.error === "expired"
                ? "expired"
                : "unavailable",
          );
          return;
        }
        setProof(value.proof);
        setProblem((current) =>
          current === "preparation" ? undefined : current,
        );
        timer = setTimeout(() => {
          if (active) {
            setProof("");
            setProblem("preparation");
          }
        }, value.validForMs);
      })
      .catch(() => {
        if (active) setProblem("unavailable");
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const errorKey =
    problem === "limited"
      ? "platform.mfa.error.limited"
      : problem === "invalid"
        ? "platform.mfa.error.invalid"
        : problem === "expired"
          ? "platform.mfa.error.expired"
          : problem === "preparation"
            ? "platform.mfa.error.preparation"
            : "platform.mfa.error.unavailable";
  return (
    <form
      className="access-form"
      action="/access/mfa/verify"
      method="post"
      onSubmit={(event) => {
        if (!proof || submitting.current) {
          event.preventDefault();
          return;
        }
        submitting.current = true;
        setPending(true);
      }}
    >
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <input type="hidden" name="proof" value={proof} />
      <p>{t("platform.mfa.prompt")}</p>
      {preparing && <p role="status">{t("platform.mfa.preparing")}</p>}
      {problem && <p role="alert">{t(errorKey)}</p>}
      <Input
        label={t("platform.mfa.code")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        disabled={!proof}
        readOnly={pending}
      />
      <Button type="submit" disabled={!proof || pending}>
        {t("platform.mfa.submit")}
      </Button>
      {!preparing && !proof && (
        <Button type="button" onClick={() => window.location.reload()}>
          {t("platform.mfa.restart")}
        </Button>
      )}
      <Link href="/sign-in">{t("session.expired.action")}</Link>
    </form>
  );
}
