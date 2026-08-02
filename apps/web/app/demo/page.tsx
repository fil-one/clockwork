import { notFound } from "next/navigation";

import type { DemoPersona } from "@clockwork/testing/personas";
import { BrandLogo, StatusBadge } from "@clockwork/ui";

import {
  demoJourneyForPersona,
  demoPersonaAccountName,
  demoPersonaCatalog,
  demoPersonaSurfacesEnabled,
} from "@/src/auth/demo-persona";
import { brandAsset } from "@/src/features/shell/brand-assets";
import { t } from "@/src/i18n/en";

import styles from "./demo-landing.module.css";

export const metadata = { title: "Guided demo" };
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

function PersonaCard({ persona }: { persona: DemoPersona }) {
  const journey = demoJourneyForPersona(persona.key);
  return (
    <article className={styles.persona}>
      <header className={styles.personaHead}>
        <span className={styles.mark} aria-hidden="true">
          {initials(persona.displayName)}
        </span>
        <span className={styles.identity}>
          <h3>{persona.displayName}</h3>
          <span className={styles.jobTitle}>{persona.jobTitle}</span>
        </span>
      </header>
      <StatusBadge tone={persona.isInternalStaff ? "info" : "neutral"}>
        {demoPersonaAccountName(persona)}
      </StatusBadge>
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
      <a
        className="cw-button cw-button--primary"
        href={`/demo/persona?persona=${persona.key}`}
      >
        {t("demo.landing.start", { name: persona.displayName })}
      </a>
    </article>
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
          src={brandAsset()}
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
      <footer className={styles.footer}>
        <p>{t("app.footer")}</p>
      </footer>
    </main>
  );
}
