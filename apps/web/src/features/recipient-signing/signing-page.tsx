"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { z } from "zod";
import { BrandLogo, Button } from "@clockwork/ui";
import {
  RecipientSigningViewSchema,
  type RecipientSigningView,
} from "@clockwork/contracts";
import { useTranslations } from "@/src/i18n/client";
import { brandAsset } from "@/src/features/shell/brand-assets";
import styles from "./signing-page.module.css";

interface Embed {
  open(): void;
  close(): void;
}
interface EmbedOptions {
  url: string;
  containerId: string;
  showHeader: boolean;
  allowRedirect: boolean;
  allowDownload: boolean;
  allowDecline: boolean;
  allowClose: boolean;
  events: {
    completed(): void;
    declined(): void;
    closed(): void;
    error(): void;
    iframeLoaded(): void;
    documentLoaded(): void;
  };
}
declare global {
  interface Window {
    SignWellEmbed?: new (options: EmbedOptions) => Embed;
  }
}

export function RecipientSigningPage({
  id,
  nonce,
  preview,
}: {
  id: string;
  nonce?: string;
  preview?: boolean;
}) {
  const t = useTranslations();
  // i18n-exempt: fictional English agreement title, matching the legal templates.
  const [view, setView] = useState<RecipientSigningView | null>(
    preview
      ? {
          title: "Mutual NDA: Fil One and Northstar",
          recipientName: "Alex Morgan",
          state: "ready",
          testMode: true,
          canDownload: false,
        }
      : null,
  );
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [frameLoading, setFrameLoading] = useState(false);
  const embed = useRef<Embed | null>(null);
  const initialized = useRef(false);
  const accessToken = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const root = `/sign/${id}`;

  const call = useCallback(
    async (action: string, body?: string) => {
      const send = () =>
        fetch(`${root}/${action}`, {
          method: action === "status" ? "GET" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          ...(body === undefined
            ? {}
            : { body, headers: { "content-type": "text/plain" } }),
        });
      let response = await send();
      if (response.status === 429) {
        // A fast completion may arrive during the launch read cooldown.
        await new Promise((resolve) => window.setTimeout(resolve, 10000));
        response = await send();
      }
      if (!response.ok) {
        if ([401, 404].includes(response.status)) setInvalid(true);
        throw new Error("SIGNING_REQUEST_FAILED");
      }
      return response.json() as Promise<unknown>;
    },
    [root],
  );

  useEffect(() => {
    if (preview || initialized.current) return;
    initialized.current = true;
    const token = window.location.hash.slice(1);
    accessToken.current = token;
    // Remove the capability before loading any third-party script. Reloads
    // use the path-scoped HttpOnly cookie minted by the exchange.
    window.history.replaceState(null, "", window.location.pathname);
    void call(token ? "access" : "status", token || undefined)
      .then((v) => {
        accessToken.current = "";
        setView(RecipientSigningViewSchema.parse(v));
      })
      .catch(() => setError(true));
  }, [call, preview]);

  const refresh = useCallback(async () => {
    if (preview) {
      setView((v) => (v ? { ...v, state: "signed" } : v));
      setUrl("");
      return;
    }
    setBusy(true);
    setError(false);
    try {
      setView(RecipientSigningViewSchema.parse(await call("refresh")));
      setUrl("");
      heading.current?.focus();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [call, preview]);

  useEffect(() => {
    if (!url || !sdkReady || !window.SignWellEmbed || preview) return;
    let active = true;
    const end = () => {
      if (active) void refresh();
    };
    let instance: Embed;
    try {
      instance = new window.SignWellEmbed({
        url,
        containerId: "recipient-document",
        // SignWell puts Agree & Finish in this header. Document branding
        // supplies the Fil One logo; hiding it would prevent completion.
        showHeader: true,
        allowRedirect: false,
        allowDownload: true,
        allowDecline: true,
        allowClose: false,
        events: {
          completed: end,
          declined: end,
          closed: () => {
            if (active) setUrl("");
          },
          error: () => {
            if (active) {
              setError(true);
              setFrameLoading(false);
            }
          },
          // Recipient signing can become usable without documentLoaded. The
          // SDK owns its inner loader; stop our outer timeout when it loads.
          iframeLoaded: () => {
            if (active) setFrameLoading(false);
          },
          documentLoaded: () => {
            if (active) setFrameLoading(false);
          },
        },
      });
      embed.current = instance;
      instance.open();
    } catch {
      setError(true);
      setFrameLoading(false);
      return;
    }
    return () => {
      active = false;
      instance.close();
      embed.current = null;
    };
  }, [url, sdkReady, preview, refresh]);

  useEffect(() => {
    if (!url || !frameLoading) return;
    const timer = window.setTimeout(() => {
      setError(true);
      setFrameLoading(false);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [url, frameLoading]);

  // Cached Commerce state only; provider calls happen on an explicit action
  // or its verified callback, not on every browser poll.
  useEffect(() => {
    if (
      !view ||
      preview ||
      invalid ||
      url ||
      ["completed", "closed"].includes(view.state)
    )
      return;
    const timer = window.setInterval(() => {
      if (!document.hidden)
        void call("status")
          .then((value) => setView(RecipientSigningViewSchema.parse(value)))
          .catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [view?.state, call, preview, invalid, url]);

  async function launch() {
    setBusy(true);
    setError(false);
    setFrameLoading(true);
    try {
      if (preview) {
        setUrl("preview");
        setFrameLoading(false);
      } else {
        const result = z.object({ url: z.url() }).parse(await call("launch"));
        setUrl(result.url);
      }
    } catch {
      setError(true);
      setFrameLoading(false);
    } finally {
      setBusy(false);
    }
  }
  const state = invalid ? "invalid" : view?.state;
  const title = state ? t(`platform.recipient.${state}`) : t("signing.loading");
  const description =
    state && ["ready", "waiting", "signed", "completed"].includes(state)
      ? t(
          `platform.recipient.${state as "ready" | "waiting" | "signed" | "completed"}Detail`,
        )
      : state
        ? t("platform.recipient.help")
        : "";
  const stage =
    state === "completed" ? 3 : state === "signed" ? 1 : url ? 1 : 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandLogo src={brandAsset()} name="Fil One" />
        <span className={styles.secure}>
          <Lock />
          {t("platform.recipient.secure")}
        </span>
      </header>
      <section className={`${styles.workspace} ${url ? styles.signing : ""}`}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{t("signing.eyebrow")}</p>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className={styles.description}>{description}</p>
          {view?.testMode ? (
            <p className={styles.test}>{t("platform.recipient.test")}</p>
          ) : null}
        </div>
        {view && !invalid ? (
          <>
            <ol className={styles.progress} aria-label={t("signing.eyebrow")}>
              {(["review", "sign", "complete"] as const).map((step, index) => (
                <li
                  key={step}
                  data-active={index <= stage}
                  aria-current={index === stage ? "step" : undefined}
                >
                  <span>{index < stage ? "✓" : index + 1}</span>
                  {t(`platform.recipient.${step}`)}
                </li>
              ))}
            </ol>
            <section className={styles.card} aria-label={view.title}>
              <div className={styles.documentHeading}>
                <div className={styles.documentIcon}>
                  <DocumentIcon />
                </div>
                <div>
                  <h2>{view.title}</h2>
                  <p>{view.recipientName}</p>
                </div>
                <span className={styles.pdf}>PDF</span>
              </div>
              {url ? (
                <>
                  {frameLoading ? (
                    <p className={styles.loading} role="status">
                      {t("signing.loading")}
                    </p>
                  ) : null}
                  {preview ? (
                    <PreviewDocument onComplete={() => void refresh()} />
                  ) : (
                    <div id="recipient-document" className={styles.frame} />
                  )}
                </>
              ) : (
                <div className={styles.cardBody}>
                  {state === "ready" ? (
                    <Button onClick={() => void launch()} disabled={busy}>
                      {t("platform.recipient.reviewSign")}{" "}
                      <span aria-hidden="true">↗</span>
                    </Button>
                  ) : null}
                  {state === "completed" && view.canDownload ? (
                    <a className={styles.download} href={`${root}/file`}>
                      {t("signing.download")} <span aria-hidden="true">↓</span>
                    </a>
                  ) : null}
                  {state === "signed" || state === "waiting" ? (
                    <Button
                      variant="secondary"
                      onClick={() => void refresh()}
                      disabled={busy}
                    >
                      {t("signing.refresh")}
                    </Button>
                  ) : null}
                  {state === "completed" || state === "signed" ? (
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </div>
              )}
            </section>
          </>
        ) : null}
        {error && !invalid ? (
          <div className={styles.error} role="alert">
            <p>{t("platform.recipient.failed")}</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (view && !sdkReady && !preview) window.location.reload();
                else if (view) void refresh();
                else
                  void call(
                    accessToken.current ? "access" : "status",
                    accessToken.current || undefined,
                  )
                    .then((v) => {
                      accessToken.current = "";
                      setView(RecipientSigningViewSchema.parse(v));
                      setError(false);
                    })
                    .catch(() => setError(true));
              }}
            >
              {t("platform.recipient.retry")}
            </Button>
          </div>
        ) : null}
        <footer className={styles.footer}>
          <Lock />
          <span>{t("platform.recipient.help")}</span>
        </footer>
      </section>
      {view && !invalid && !preview ? (
        <Script
          src="https://static.signwell.com/assets/embedded.js"
          nonce={nonce}
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
          onError={() => {
            setError(true);
            setFrameLoading(false);
          }}
        />
      ) : null}
    </main>
  );
}

function Lock() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function DocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="28"
      viewBox="0 0 24 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M5 2h9l5 5v19H5zM14 2v6h5M9 13h6M9 17h6M9 21h4" />
    </svg>
  );
}

// The preview is fictional and cannot create a document or call a provider.
function PreviewDocument({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations();
  return (
    <div className={styles.preview}>
      <p className={styles.test}>{t("platform.recipient.preview")}</p>
      {/* i18n-exempt: fictional English agreement specimen, matching the English legal templates. */}
      <article lang="en">
        <p className={styles.eyebrow}>FIL ONE · AGREEMENTS</p>
        <h3>Mutual Non-Disclosure Agreement</h3>
        <p>
          This preview illustrates the document space. The live experience
          displays the actual agreement and signing fields here.
        </p>
        <hr />
        <h4>Between Fil One and Northstar</h4>
        <p>
          Each party agrees to protect confidential information disclosed in
          connection with evaluating a business relationship.
        </p>
        <p>
          The approved agreement remains the authoritative document. This
          illustrative preview does not capture a signature.
        </p>
        <div className={styles.signatureLine}>
          <span>Alex Morgan</span>
          <small>Authorized signatory · Northstar</small>
        </div>
      </article>
      <Button onClick={onComplete}>
        {t("platform.recipient.finishPreview")}
      </Button>
    </div>
  );
}
