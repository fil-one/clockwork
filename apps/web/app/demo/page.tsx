import { getLocale, getTranslations } from "@/src/i18n/server";
import type { Metadata } from "next";
import { use } from "react";
import { notFound } from "next/navigation";

import type { DemoPersona } from "@clockwork/testing/personas";
import { BrandLogo } from "@clockwork/ui";

import {
  demoPersonaAccountName,
  demoPersonaCatalog,
  demoPersonaIntent,
  demoPersonaJobTitle,
  demoPersonaSurfacesEnabled,
} from "@/src/auth/demo-persona";
import { brandAsset } from "@/src/features/shell/brand-assets";

import { DemoLanguageSelector } from "./demo-language-selector";
import styles from "./demo-landing.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("demo.landing.eyebrow") };
}
// The demo flag is read per request, so the page must never be prerendered
// against the environment a build happened to run in.
export const dynamic = "force-dynamic";

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function PersonaRow({ persona }: { persona: DemoPersona }) {
  const t = use(getTranslations());
  return (
    <li className={styles.row}>
      <span className={styles.mark} aria-hidden="true">
        {initials(persona.displayName)}
      </span>
      <span className={styles.identity}>
        <span className={styles.name}>{persona.displayName}</span>
        <span className={styles.role}>
          {demoPersonaJobTitle(persona.key, t)}
        </span>
      </span>
      <span className={styles.account}>{demoPersonaAccountName(persona)}</span>
      <p className={styles.intent}>{demoPersonaIntent(persona.key, t)}</p>
      <a className={styles.start} href={`/demo/persona?persona=${persona.key}`}>
        {t("demo.landing.start", { name: persona.displayName })}
      </a>
    </li>
  );
}

function PersonaGroup({
  id,
  heading,
  personas,
}: {
  id: string;
  heading: string;
  personas: readonly DemoPersona[];
}) {
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 id={id} className={styles.groupHeading}>
        {heading}
      </h2>
      <ul className={styles.roster}>
        {personas.map((persona) => (
          <PersonaRow key={persona.key} persona={persona} />
        ))}
      </ul>
    </section>
  );
}

export default function Page() {
  const t = use(getTranslations());
  const locale = use(getLocale());
  if (!demoPersonaSurfacesEnabled(process.env)) notFound();
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div className={styles.topbar}>
          <BrandLogo
            className={styles.wordmark ?? ""}
            src={brandAsset()}
            name={t("app.name")}
          />
          <DemoLanguageSelector />
        </div>
        <h1 className={styles.title}>{t("demo.landing.title")}</h1>
        <p className={styles.description}>{t("demo.landing.description")}</p>
      </header>
      <nav className={styles.navigation}>
        <a href={`https://fil-one-commerce-preview.netlify.app/${locale}`}>
          {t("demo.workspace.overview")}
        </a>
        <a href={`https://fil-one-commerce-preview.netlify.app/${locale}/tour`}>
          {t("demo.workspace.tour")}
        </a>
      </nav>
      <div className={styles.groups}>
        {[
          {
            id: "customers",
            heading: t("demo.workspace.customers"),
            keys: ["directBuyer", "billingUser", "endClient"],
          },
          {
            id: "partners",
            heading: t("demo.workspace.partners"),
            keys: ["reseller", "distributor", "referralPartner"],
          },
          {
            id: "teams",
            heading: t("demo.workspace.teams"),
            keys: ["financeApprover", "internalOperator", "legalApprover"],
          },
        ].map((group) => (
          <PersonaGroup
            key={group.id}
            id={`demo-group-${group.id}`}
            heading={group.heading}
            personas={group.keys.flatMap((key) =>
              demoPersonaCatalog.filter((persona) => persona.key === key),
            )}
          />
        ))}
      </div>
      <footer className={styles.footer}>
        <p>{t("demo.workspace.footer")}</p>
      </footer>
    </main>
  );
}
