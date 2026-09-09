"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { customerPartnerCopy } from "./copy";
import styles from "./unsaved-changes.module.css";

const copy = customerPartnerCopy.common;

/**
 * The browser-level half of unsaved-work protection.
 *
 * ## Exactly when this fires
 *
 * A `beforeunload` listener is attached only while `armed` is true, and the
 * browser only consults an attached listener on a *document unload*. So the
 * prompt appears on, and only on:
 *
 * - reloading the tab, closing the tab, or closing the window;
 * - navigating to an address outside this application (typed URL, bookmark,
 *   an external link, a `window.location` assignment);
 * - the back/forward gesture leaving the document.
 *
 * It does **not** fire on, and cannot be made to fire on:
 *
 * - a successful submission -- callers drop `armed` the moment the server
 *   accepts, and none of these forms navigate on success anyway;
 * - client-side navigation within the app, including every `next/link` click
 *   and every `router.push`. The App Router does not unload the document, so
 *   no listener is consulted. That gap is why `LeaveDraftControl` exists; the
 *   two together are the protection, and neither is it on its own.
 *
 * The arming condition is the whole design. A listener attached
 * unconditionally fires on every reload of an untouched form and on the way
 * out of a completed one, which teaches people to hit "Leave" without reading
 * -- a defect of its own, and a worse one, because it also disarms the prompt
 * on the day it matters. Each caller states its own condition; all of them
 * reduce to "the reader has typed something that is not on the server yet".
 *
 * `preventDefault()` is the whole handler. Returning a string, or assigning
 * `event.returnValue`, has been ignored by every current browser for years:
 * the text shown is the browser's own and cannot be set by the page.
 */
export function useUnsavedChangesWarning(armed: boolean): void {
  useEffect(() => {
    if (!armed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [armed]);
}

/**
 * The in-application half: the builder's own "cancel and return" escape hatch.
 *
 * This is the click the finding is about. `quote-builder.tsx` offered a bare
 * `next/link` back to the collection, one stray click from a fully entered
 * three-stage draft to nothing, with no confirmation and nothing recoverable
 * afterwards. `beforeunload` cannot cover it -- an App Router link never
 * unloads the document -- so the control has to ask.
 *
 * ## Exactly when this interposes
 *
 * Only while `armed`. Unarmed -- an untouched form, or one whose work the
 * server has already accepted -- it renders the same plain link it always did
 * and one click still leaves. That matters: a confirmation on the way out of a
 * form with nothing in it is an obstacle to a legitimate operation, and there
 * is no state in which this control refuses to let someone leave. The
 * confirmation is one extra click and always offers `Discard and leave` as a
 * real link, so leaving is never more than two clicks and never blocked.
 */
export function LeaveDraftControl({
  armed,
  href,
  label,
  className = "",
  discardClassName = "",
  keepClassName = "",
}: {
  armed: boolean;
  href: Route;
  label: string;
  className?: string;
  discardClassName?: string;
  keepClassName?: string;
}) {
  const t = useTranslations();
  const localizedcopy = localizeCopy(copy, t);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const promptId = useId();

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // Disarming while the prompt is open -- a submission that lands underneath
  // it -- closes the prompt rather than leaving a question about discarding
  // work that is now saved.
  useEffect(() => {
    if (!armed) setConfirming(false);
  }, [armed]);

  if (!armed || !confirming)
    return armed ? (
      <button
        className={className}
        onClick={() => setConfirming(true)}
        type="button"
      >
        {label}
      </button>
    ) : (
      <Link className={className} href={href}>
        {label}
      </Link>
    );

  return (
    <div
      aria-labelledby={promptId}
      className={styles.prompt}
      role="group"
      data-unsaved-prompt="open"
    >
      <p id={promptId} role="alert">
        <strong>{localizedcopy.unsavedTitle}</strong>{" "}
        {localizedcopy.unsavedBody}
      </p>
      <div className={styles.promptActions}>
        <button
          className={keepClassName || className}
          onClick={() => setConfirming(false)}
          ref={keepRef}
          type="button"
        >
          {localizedcopy.unsavedKeep}
        </button>
        <Link className={discardClassName} href={href}>
          {localizedcopy.unsavedDiscard}
        </Link>
      </div>
    </div>
  );
}
