import { notFound } from "next/navigation";

import type { DemoPersona } from "@clockwork/testing/personas";
import { BrandLogo, DocumentCard, StatusBadge } from "@clockwork/ui";

import {
  demoJourneyForPersona,
  demoPersonaAccountName,
  demoPersonaCatalog,
  demoPersonaSurfacesEnabled,
} from "@/src/auth/demo-persona";
import { t } from "@/src/i18n/en";

import styles from "./demo-landing.module.css";

export const metadata = { title: "Guided demo" };
// The demo flag is read per request, so the page must never be prerendered
// against the environment a build happened to run in.
export const dynamic = "force-dynamic";

function PersonaCard({ persona }: { persona: DemoPersona }) {
  const journey = demoJourneyForPersona(persona.key);
  return (
    <DocumentCard
      title={persona.displayName}
      type={persona.jobTitle}
      status={
        <StatusBadge tone={persona.isInternalStaff ? "info" : "neutral"}>
          {demoPersonaAccountName(persona)}
        </StatusBadge>
      }
      summary={
        <dl className={styles.summary}>
          {journey ? (
            <div>
              <dt>{t("demo.landing.journey")}</dt>
              <dd>{journey.title}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("demo.landing.intent")}</dt>
            <dd>{persona.journeyIntent}</dd>
          </div>
        </dl>
      }
      actions={
        <a
          className="cw-button cw-button--primary"
          href={`/demo/persona?persona=${persona.key}`}
        >
          {t("demo.landing.start", { name: persona.displayName })}
        </a>
      }
    />
  );
}

function PersonaGroup({
  heading,
  personas,
}: {
  heading: string;
  personas: readonly DemoPersona[];
}) {
  const id = `demo-group-${heading.replaceAll(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <div className={styles.grid}>
        {personas.map((persona) => (
          <PersonaCard key={persona.key} persona={persona} />
        ))}
      </div>
    </section>
  );
}

export default function Page() {
  if (!demoPersonaSurfacesEnabled(process.env)) notFound();
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <BrandLogo
          className={styles.wordmark ?? ""}
          src="/brand/fo-wordmark-dark.png"
          name={t("app.name")}
        />
        <p className="eyebrow">{t("demo.landing.eyebrow")}</p>
        <h1>{t("demo.landing.title")}</h1>
        <p>{t("demo.landing.description")}</p>
      </header>
      <PersonaGroup
        heading={t("demo.landing.external")}
        personas={demoPersonaCatalog.filter(
          (persona) => !persona.isInternalStaff,
        )}
      />
      <PersonaGroup
        heading={t("demo.landing.internal")}
        personas={demoPersonaCatalog.filter(
          (persona) => persona.isInternalStaff,
        )}
      />
    </main>
  );
}
