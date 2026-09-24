"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandLogo } from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";
import {
  formatDate,
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";
import { brandAsset } from "@/src/features/shell/brand-assets";

import { DemoLanguageSelector } from "../../demo-language-selector";
import {
  clientReviewFailureMessages,
  isClientReviewFailure,
  type ClientReviewFailure,
} from "./response-failure";
import styles from "./review.module.css";

const receivedMessages: Readonly<Record<string, MessageId>> = {
  request_order: "demo.clientReview.received.order",
  request_changes: "demo.clientReview.received.changes",
  decline: "demo.clientReview.received.decline",
};

/** Rate-card region slugs. An unknown slug is shown as the identifier it is. */
const regionMessages: Readonly<Record<string, MessageId>> = {
  "us-east": "region.usEast",
  "eu-west": "region.euWest",
  "uk-south": "region.ukSouth",
};

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
  const locale = useFormattingLocale();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ClientReviewFailure | null>(null);
  const capacity = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "terabyte",
    maximumFractionDigits: 3,
  });
  // Rendered on the server and again in the browser: a fixed zone, named in
  // the text, keeps both renders identical.
  const respondedAt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const received = quote.response
    ? receivedMessages[quote.response.decision]
    : undefined;
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <DemoLanguageSelector />
        <BrandLogo
          src={brandAsset()}
          name={t("app.name")}
          className={styles.logo ?? ""}
        />
        <div>
          <p>{t("demo.clientReview.eyebrow")}</p>
          <h1>{quote.name}</h1>
          <p>
            {t("demo.clientReview.validity", {
              revision: quote.version,
              date: formatDate(new Date(quote.expiresAt), locale),
            })}
          </p>
        </div>
      </header>
      <section className={styles.panel}>
        <h2>{t("demo.clientReview.title")}</h2>
        <ul>
          {quote.lines.map((line, index) => {
            const region = regionMessages[line.region];
            return (
              <li key={index}>
                {t("demo.clientReview.line", {
                  capacity: capacity.format(Number(line.quantity)),
                  sku: line.sku,
                  region: region ? t(region) : line.region,
                  count: line.termMonths,
                })}
              </li>
            );
          })}
        </ul>
        <strong>
          {formatMoney(
            quote.total.minor,
            // The resale total is in the partner price book's currency.
            quote.total.currency as SupportedCurrency,
            locale,
          )}
        </strong>
        <p>
          {richText(t, "demo.clientReview.seller", {
            seller: <strong>{quote.sellerName}</strong>,
          })}
        </p>
      </section>
      {quote.response ? (
        <section className={styles.panel}>
          {received ? <h2>{t(received)}</h2> : null}
          <p>
            {t("demo.clientReview.sentBy", {
              name: quote.response.name,
              time: respondedAt.format(new Date(quote.response.at)),
            })}
          </p>
          <p>{quote.response.note}</p>
          <p>{t("demo.clientReview.visible")}</p>
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
              setFailure(null);
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
                if (!response.ok) {
                  const result: unknown = await response
                    .json()
                    .catch(() => null);
                  const code =
                    result && typeof result === "object" && "code" in result
                      ? result.code
                      : undefined;
                  setFailure(isClientReviewFailure(code) ? code : "unsent");
                  return;
                }
                router.refresh();
              } catch {
                setFailure("unsent");
              } finally {
                busy.current = false;
                setPending(false);
              }
            })();
          }}
        >
          <h2>{t("demo.clientReview.respond")}</h2>
          <div className={styles.formGrid}>
            <label>
              {t("demo.clientReview.name")}{" "}
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <label>
              {t("demo.clientReview.response")}{" "}
              <select name="decision">
                <option value="request_order">
                  {t("demo.clientReview.requestOrder")}
                </option>
                <option value="request_changes">
                  {t("demo.clientReview.requestChanges")}
                </option>
                <option value="decline">
                  {t("demo.clientReview.decline")}
                </option>
              </select>
            </label>
            <label>
              {t("demo.clientReview.note")}{" "}
              <textarea name="note" maxLength={2000} />
            </label>
          </div>
          <label>
            <input type="checkbox" name="authority" required />
            {t("demo.clientReview.attest")}
          </label>
          <p>{t("demo.clientReview.boundary")}</p>
          <button className={styles.primary} disabled={pending}>
            {pending
              ? t("demo.clientReview.sending")
              : t("demo.clientReview.submit")}
          </button>
          <p role="alert">
            {failure ? t(clientReviewFailureMessages[failure]) : ""}
          </p>
        </form>
      )}
    </main>
  );
}
