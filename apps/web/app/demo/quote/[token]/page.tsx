import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { clientReview } from "@/src/features/customer-partner/partner/demo-client-review";
import { getTranslations } from "@/src/i18n/server";

import { DemoLanguageSelector } from "../../demo-language-selector";
import { ClientQuoteReview } from "./review";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("demo.clientReview.pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!demoDeployIdentityEnabled(process.env)) notFound();
  const { token } = await params;
  const view = clientReview(await configuredDemoStateStore().read(), token);
  if (!view) {
    const t = await getTranslations();
    return (
      <main id="main-content" className={styles.main}>
        <header className={styles.header}>
          <DemoLanguageSelector />
          <h1>{t("demo.clientReview.unavailable")}</h1>
          <p>{t("demo.clientReview.expired")}</p>
        </header>
      </main>
    );
  }
  return <ClientQuoteReview token={token} quote={view} />;
}
