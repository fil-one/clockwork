import Link from "next/link";
import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";
import type { MessageId } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";
import type { Loaded } from "./loaders";
import styles from "./contracts.module.css";

type Unready = Exclude<Loaded<object>, { kind: "ready" }>;
type Situation = "mfa" | "demo" | "forbidden" | "missing" | "error";

const copy: Readonly<
  Record<
    "contracts" | "salesLibrary",
    Readonly<Record<Situation, { title: MessageId; body: MessageId }>>
  >
> = {
  contracts: {
    mfa: {
      title: "operations.contracts.access.mfaTitle",
      body: "operations.contracts.access.mfaBody",
    },
    demo: {
      title: "operations.contracts.access.demoTitle",
      body: "operations.contracts.access.demoBody",
    },
    forbidden: {
      title: "operations.contracts.access.forbiddenTitle",
      body: "operations.contracts.access.forbiddenBody",
    },
    missing: {
      title: "operations.contracts.access.missingTitle",
      body: "operations.contracts.access.missingBody",
    },
    error: {
      title: "operations.contracts.access.errorTitle",
      body: "operations.contracts.access.errorBody",
    },
  },
  salesLibrary: {
    mfa: {
      title: "operations.salesLibrary.access.mfaTitle",
      body: "operations.contracts.access.mfaBody",
    },
    demo: {
      title: "operations.salesLibrary.access.demoTitle",
      body: "operations.salesLibrary.access.demoBody",
    },
    forbidden: {
      title: "operations.salesLibrary.access.forbiddenTitle",
      body: "operations.contracts.access.forbiddenBody",
    },
    missing: {
      title: "operations.salesLibrary.access.missingTitle",
      body: "operations.salesLibrary.access.missingBody",
    },
    error: {
      title: "operations.salesLibrary.access.errorTitle",
      body: "operations.contracts.access.errorBody",
    },
  },
};

function situation(state: Unready): Situation {
  if (state.kind !== "denied") return state.kind;
  if (state.code === "CONTRACT_MFA_REQUIRED") return "mfa";
  if (state.code === "CONTRACT_DEMO_UNAVAILABLE") return "demo";
  return "forbidden";
}

/** The page a refused or failed load shows: what happened and what to do. */
export async function ContractPageState({
  state,
  title,
  area = "contracts",
}: {
  state: Unready;
  title: string;
  area?: "contracts" | "salesLibrary";
}) {
  const t = await getTranslations();
  const which = situation(state);
  const message = copy[area][which];
  return (
    <main className={styles.page} id="main-content">
      <h1 className="cw-sr-only">{title}</h1>
      <ApplicationStatePanel
        state={
          which === "error"
            ? "recoverable-error"
            : which === "missing"
              ? "empty"
              : "permission"
        }
        title={t(message.title)}
        description={t(message.body)}
        action={
          which === "missing" && area === "contracts" ? (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/internal/contracts"
            >
              {t("operations.contracts.backToRegister")}
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}
