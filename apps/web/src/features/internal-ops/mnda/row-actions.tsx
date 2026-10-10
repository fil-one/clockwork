"use client";
import { useId, useState, type ReactNode } from "react";
import type { MndaRecord } from "@clockwork/contracts";
import {
  Button,
  ChevronDown,
  Tooltip,
  type ButtonClassNameOptions,
} from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";
import styles from "./workspace.module.css";

export type MndaRowAction =
  | "continue"
  | "remind"
  | "fixEmail"
  | "checkStatus"
  | "signedPdf"
  | "copy"
  | "openPdf";

const unsent: readonly MndaRecord["state"][] = [
  "draft",
  "preparing",
  "ready",
  "sending",
];

/**
 * The one action a row leads with, by state: finish a draft, chase whoever
 * holds it, repair a bounced email, collect the signed PDF, or start again
 * from a closed one. Everything else sits under More.
 */
export function primaryRowAction(
  record: Pick<MndaRecord, "state">,
  { bound, correctable }: { bound: boolean; correctable: boolean },
): MndaRowAction {
  const { state } = record;
  if (unsent.includes(state)) return "continue";
  if (["sent", "viewed", "awaiting_countersignature"].includes(state))
    return "remind";
  if (state === "completed") return "signedPdf";
  if (state === "attention")
    return correctable ? "fixEmail" : bound ? "checkStatus" : "openPdf";
  if (state === "canceled") return bound ? "copy" : "openPdf";
  return "copy";
}

/**
 * A control that cannot act right now. It stays focusable and says why on
 * hover, focus and tap, where a disabled button would say nothing.
 */
export function BlockedButton({
  reason,
  variant = "quiet",
  size = "small",
  className,
  children,
}: {
  reason: string;
  variant?: ButtonClassNameOptions["variant"];
  size?: ButtonClassNameOptions["size"];
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Tooltip
      trigger={
        <Button
          variant={variant}
          size={size}
          {...(className ? { className } : {})}
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
        >
          {children}
        </Button>
      }
    >
      {reason}
    </Tooltip>
  );
}

/**
 * A row's lead action, then More: a disclosure listing the rest, with the
 * destructive ones last behind a rule. The list stays mounted while folded so
 * a dialog opened from it keeps its state.
 */
export function RowActionMenu({
  company,
  primary,
  more,
  destructive,
}: {
  company: string;
  primary: ReactNode;
  more: readonly ReactNode[];
  destructive: readonly ReactNode[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const items = more.filter(Boolean);
  const last = destructive.filter(Boolean);
  return (
    <div className={styles.rowActions}>
      {primary}
      {items.length + last.length > 0 ? (
        <>
          <Button
            variant="quiet"
            size="small"
            className={styles.moreToggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t("operations.mnda.moreFor", { company })}
            onClick={() => setOpen((current) => !current)}
          >
            {t("operations.mnda.more")}
            <ChevronDown aria-hidden="true" />
          </Button>
          <div id={panelId} className={styles.morePanel} hidden={!open}>
            {items.length > 0 ? (
              <ul className={styles.moreList}>
                {items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
            {last.length > 0 ? (
              <ul className={`${styles.moreList} ${styles.moreDestructive}`}>
                {last.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
