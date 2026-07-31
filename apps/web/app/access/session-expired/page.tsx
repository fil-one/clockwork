import Link from "next/link";
import { t } from "@/src/i18n/en";
export default function Page() {
  return (
    <main className="access-main">
      <section className="access-card">
        <div className="signing-wordmark">FIL ONE</div>
        <p className="eyebrow">401</p>
        <h1>{t("session.expired.title")}</h1>
        <p>{t("session.expired.description")}</p>
        <Link className="cw-button cw-button--primary" href="/sign-in">
          {t("session.expired.action")}
        </Link>
      </section>
    </main>
  );
}
