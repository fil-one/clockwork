"use client";
import { useLocale, useTranslations } from "@/src/i18n/client";
import { formattingLocales } from "@/src/i18n";
import { DemoLanguageSelector } from "../../demo-language-selector";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./review.module.css";
import { BrandLogo } from "@clockwork/ui";
import { brandAsset } from "@/src/features/shell/brand-assets";
export function ClientQuoteReview({
  token,
  quote,
}: {
  token: string;
  quote: {
    name: string;
    version: number;
    lines: {
      sku: string;
      region: string;
      quantity: string;
      termMonths: number;
    }[];
    total: { currency: string; minor: string };
    expiresAt: string;
    sellerName: string;
    response?:
      { decision: string; name: string; note: string; at: string } | undefined;
  };
}) {
  const router = useRouter();
  const t = useTranslations();
  const locale = formattingLocales[useLocale()];
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const labels: Record<string, string> = {
    request_order: t("clientReview.receivedOrder"),
    request_changes: t("clientReview.receivedChanges"),
    decline: t("clientReview.receivedDecline"),
  };
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <DemoLanguageSelector />
        <BrandLogo
          src={brandAsset()}
          name="Fil One"
          className={styles.logo ?? ""}
        />
        <div>
          <p>{t("clientReview.eyebrow")}</p>
          <h1>{quote.name}</h1>
          <p>
            {t("clientReview.valid", {
              revision: quote.version,
              date: new Date(quote.expiresAt).toLocaleDateString(locale),
            })}
          </p>
        </div>
      </header>
      <section className={styles.panel}>
        <h2>{t("clientReview.title")}</h2>
        <ul>
          {quote.lines.map((line, index) => (
            <li key={index}>
              {line.quantity} TB · {line.sku} · {line.region} ·{" "}
              {line.termMonths} months
            </li>
          ))}
        </ul>
        <strong>
          {new Intl.NumberFormat(locale, {
            style: "currency",
            currency: quote.total.currency,
          }).format(Number(quote.total.minor) / 100)}
        </strong>
        <p>
          <strong>{quote.sellerName}</strong> · {t("clientReview.seller")}
        </p>
      </section>
      {quote.response ? (
        <section className={styles.panel}>
          <h2>{labels[quote.response.decision]}</h2>
          <p>
            {quote.response.name} ·{" "}
            {new Date(quote.response.at).toLocaleString(locale)}
          </p>
          <p>{quote.response.note}</p>
          <p>{t("clientReview.visible")}</p>
        </section>
      ) : (
        <form
          className={styles.panel}
          onSubmit={(event) => {
            void (async () => {
              event.preventDefault();
              if (busy.current) return;
              const data = new FormData(event.currentTarget);
              busy.current = true;
              setPending(true);
              setMessage("");
              try {
                const csrf =
                  document.cookie
                    .split("; ")
                    .find((item) => item.startsWith("clockwork-csrf="))
                    ?.split("=")[1] ?? "";
                const response = await fetch(`/demo/quote/${token}/respond`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-csrf-token": decodeURIComponent(csrf),
                  },
                  body: JSON.stringify({
                    decision: data.get("decision"),
                    name: data.get("name"),
                    note: data.get("note"),
                    authority: data.get("authority") === "on",
                  }),
                });
                const result = (await response.json()) as { detail?: string };
                if (!response.ok)
                  throw new Error(
                    result.detail ?? "Response could not be saved.",
                  );
                router.refresh();
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "Please retry.",
                );
              } finally {
                busy.current = false;
                setPending(false);
              }
            })();
          }}
        >
          <h2>{t("clientReview.respond")}</h2>
          <div className={styles.formGrid}>
            <label>
              {t("clientReview.name")}{" "}
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <label>
              {t("clientReview.response")}{" "}
              <select name="decision">
                <option value="request_order">
                  {t("clientReview.requestOrder")}
                </option>
                <option value="request_changes">
                  {t("clientReview.requestChanges")}
                </option>
                <option value="decline">{t("clientReview.decline")}</option>
              </select>
            </label>
            <label>
              {t("clientReview.note")} <textarea name="note" maxLength={2000} />
            </label>
          </div>
          <label>
            <input type="checkbox" name="authority" required />
            {t("clientReview.attest")}{" "}
          </label>
          <p>{t("clientReview.boundary")} </p>
          <button className={styles.primary} disabled={pending}>
            {pending ? t("clientReview.saving") : t("clientReview.submit")}
          </button>
          <p role="alert">{message}</p>
        </form>
      )}
    </main>
  );
}
