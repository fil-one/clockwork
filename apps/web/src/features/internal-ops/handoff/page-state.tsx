import type { Route } from "next";
import Link from "next/link";

import { Breadcrumbs, InlineNotice, PageHeader } from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { MessageId } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

import styles from "./handoff.module.css";

/**
 * A handoff or organization page that has nothing to show: turned off in the
 * demo (info), or not readable right now (danger). It keeps the page's
 * heading and trail so the reader knows where they are, and offers no action
 * that depends on the missing data.
 */
export async function OperationsPageState({
  heading,
  parent,
  state,
  demo,
  unavailable,
}: {
  heading: MessageId;
  /** The list page this one sits under. */
  parent?: { label: MessageId; href: Route };
  state: "demo" | "unavailable";
  demo: { title: MessageId; body?: MessageId };
  unavailable: MessageId;
}) {
  const t = await getTranslations();
  return (
    <main className={styles.main} id="main-content">
      {parent ? (
        <Breadcrumbs
          label={breadcrumbsLabel(t)}
          items={[
            { label: t(parent.label), href: parent.href },
            { label: t(heading) },
          ]}
          renderLink={(href, label) => (
            <Link href={href as Route}>{label}</Link>
          )}
        />
      ) : null}
      <PageHeader title={t(heading)} />
      {state === "demo" ? (
        <InlineNotice
          tone="info"
          title={t(demo.title)}
          {...(demo.body ? { description: t(demo.body) } : {})}
        />
      ) : (
        <InlineNotice tone="danger" title={t(unavailable)} />
      )}
    </main>
  );
}

/** A single handoff that cannot be shown. */
export function HandoffPageState({ state }: { state: "demo" | "unavailable" }) {
  return (
    <OperationsPageState
      heading="operations.handoff.detail.title"
      parent={{
        label: "operations.handoff.queue.title",
        href: "/internal/handoffs",
      }}
      state={state}
      demo={{
        title: "operations.handoff.queue.demoTitle",
        body: "operations.handoff.queue.demoBody",
      }}
      unavailable="operations.handoff.detail.unavailable"
    />
  );
}
