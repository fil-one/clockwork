"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Button, Input, Select, Textarea } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { requestHandoff } from "./actions";
import { HandoffOutcomeBanner, type HandoffOutcome } from "./outcome-banner";
import styles from "./handoff.module.css";

const wide = styles.wide ?? "";

export interface HandoffFormOption {
  id: string;
  label: string;
}

/**
 * The seller's request on an executed contract. The request id is minted
 * once per form, so a retried submission returns the request already saved.
 */
export function HandoffRequestForm({
  contractId,
  legalName,
  signer,
  mndas,
  scenarios,
}: {
  contractId: string;
  legalName: string;
  signer: { name: string; email: string; title: string } | null;
  mndas: readonly HandoffFormOption[];
  scenarios: readonly HandoffFormOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<HandoffOutcome | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) =>
    fields[name] ? t("operations.handoff.error.INVALID_INPUT") : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    requestId.current ??= crypto.randomUUID();
    const input = {
      id: requestId.current,
      contractIds: [contractId],
      counterpartyLegalName: text("counterpartyLegalName"),
      signerName: text("signerName"),
      signerEmail: text("signerEmail"),
      signerTitle: text("signerTitle"),
      requestedSide: text("requestedSide"),
      mndaId: text("mndaId") || null,
      pricingScenarioId: text("pricingScenarioId") || null,
      notes: text("notes"),
    };
    setOutcome(null);
    setFields({});
    startTransition(async () => {
      const result = await requestHandoff(input).catch(() => ({
        ok: false as const,
        code: "UNEXPECTED",
      }));
      if (result.ok) {
        requestId.current = null;
        setOpen(false);
        setOutcome({
          tone: "success",
          message: t("operations.handoff.form.done"),
        });
        router.refresh();
        return;
      }
      setFields("fields" in result && result.fields ? result.fields : {});
      setOutcome({ tone: "danger", code: result.code });
    });
  }

  return (
    <div className={styles.block}>
      <HandoffOutcomeBanner
        outcome={outcome}
        onReloaded={() => setOutcome(null)}
      />
      {open ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Input
            fieldClassName={wide}
            label={t("operations.handoff.form.legalName")}
            name="counterpartyLegalName"
            defaultValue={legalName}
            maxLength={200}
            required
            error={fieldError("counterpartyLegalName")}
          />
          <Input
            label={t("operations.handoff.form.signerName")}
            name="signerName"
            defaultValue={signer?.name ?? ""}
            maxLength={200}
            required
            error={fieldError("signerName")}
          />
          <Input
            label={t("operations.handoff.form.signerEmail")}
            help={t("operations.handoff.form.signerEmailHelp")}
            name="signerEmail"
            type="email"
            defaultValue={signer?.email ?? ""}
            maxLength={320}
            required
            error={fieldError("signerEmail")}
          />
          <Input
            label={t("operations.handoff.form.signerTitle")}
            optionalLabel={t("operations.handoff.form.optional")}
            name="signerTitle"
            defaultValue={signer?.title ?? ""}
            maxLength={200}
          />
          <Select
            label={t("operations.handoff.form.side")}
            name="requestedSide"
            defaultValue="customer"
            options={[
              {
                value: "customer",
                label: t("operations.handoff.side.customer"),
              },
              { value: "partner", label: t("operations.handoff.side.partner") },
            ]}
          />
          <Select
            label={t("operations.handoff.form.mnda")}
            optionalLabel={t("operations.handoff.form.optional")}
            name="mndaId"
            defaultValue={mndas[0]?.id ?? ""}
            options={[
              { value: "", label: t("operations.handoff.form.mndaNone") },
              ...mndas.map(({ id, label }) => ({ value: id, label })),
            ]}
          />
          <Select
            label={t("operations.handoff.form.scenario")}
            optionalLabel={t("operations.handoff.form.optional")}
            name="pricingScenarioId"
            defaultValue=""
            options={[
              { value: "", label: t("operations.handoff.form.scenarioNone") },
              ...scenarios.map(({ id, label }) => ({ value: id, label })),
            ]}
          />
          <Textarea
            fieldClassName={wide}
            label={t("operations.handoff.form.notes")}
            help={t("operations.handoff.form.notesHelp")}
            optionalLabel={t("operations.handoff.form.optional")}
            name="notes"
            rows={4}
            maxLength={4000}
            error={fieldError("notes")}
          />
          <div className={`${styles.actions} ${styles.wide}`}>
            <Button type="submit" variant="primary" loading={pending}>
              {pending
                ? t("operations.handoff.form.pending")
                : t("operations.handoff.form.submit")}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setOutcome(null);
              setOpen(true);
            }}
          >
            {t("operations.handoff.form.open")}
          </Button>
        </div>
      )}
    </div>
  );
}
