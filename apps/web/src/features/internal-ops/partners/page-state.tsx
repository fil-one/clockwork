import Link from "next/link";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

import { partnersPath } from "./model";
import type { PartnerLoaded } from "./server";
import styles from "./partners.module.css";

type Unready = Exclude<PartnerLoaded<object>, { kind: "ready" }>;
type Situation = "mfa" | "demo" | "forbidden" | "missing" | "error";

const copy: Readonly<Record<Situation, { title: MessageId; body: MessageId }>> =
  {
    mfa: {
      title: "operations.partners.access.mfaTitle",
      body: "operations.partners.access.mfaBody",
    },
    demo: {
      title: "operations.partners.access.demoTitle",
      body: "operations.partners.access.demoBody",
    },
    forbidden: {
      title: "operations.partners.access.forbiddenTitle",
      body: "operations.partners.access.forbiddenBody",
    },
    missing: {
      title: "operations.partners.access.missingTitle",
      body: "operations.partners.access.missingBody",
    },
    error: {
      title: "operations.partners.access.errorTitle",
      body: "operations.partners.access.errorBody",
    },
  };

function situation(state: Unready): Situation {
  if (state.kind !== "denied") return state.kind;
  if (state.code === "CONTRACT_MFA_REQUIRED") return "mfa";
  if (state.code === "CONTRACT_DEMO_UNAVAILABLE") return "demo";
  return "forbidden";
}

/** What a refused or failed partner page shows, and where to go instead. */
export async function PartnerPageState({
  state,
  title,
}: {
  state: Unready;
  title: string;
}) {
  const t = await getTranslations();
  const which = situation(state);
  return (
    <main className={styles.main} id="main-content">
      <h1 className="cw-sr-only">{title}</h1>
      <ApplicationStatePanel
        state={
          which === "error"
            ? "recoverable-error"
            : which === "missing"
              ? "empty"
              : "permission"
        }
        title={t(copy[which].title)}
        description={t(copy[which].body)}
        action={
          which === "missing" || which === "demo" ? (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={partnersPath}
            >
              {t("operations.partners.backToList")}
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}
