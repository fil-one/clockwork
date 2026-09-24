import { useId } from "react";

export type RenewalState =
  | "auto-renews"
  | "evergreen"
  | "notice-open"
  | "non-renewing"
  | "renewed"
  | "expired";

export type TermBarVariant = "standard" | "compact" | "table";

export interface TermProgress {
  elapsedPercent: number;
  noticeStartPercent?: number;
  noticeEndPercent?: number;
  daysElapsed: number;
  daysRemaining: number;
  isNoticeOpen: boolean;
  hasStarted: boolean;
  hasEnded: boolean;
}

const DAY_IN_MS = 86_400_000;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function validTime(value: Date, name: string): number {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new RangeError(`${name} must be a valid Date`); // i18n-exempt: developer invariant
  }
  return time;
}

/** Pure date arithmetic used by every visual TermBar variant. */
export function calculateTermProgress({
  start,
  end,
  now,
  noticeStart,
  noticeEnd,
}: {
  start: Date;
  end: Date;
  now: Date;
  noticeStart?: Date;
  noticeEnd?: Date;
}): TermProgress {
  const startTime = validTime(start, "start");
  const endTime = validTime(end, "end");
  const nowTime = validTime(now, "now");
  if (endTime <= startTime) {
    throw new RangeError("end must be after start"); // i18n-exempt: developer invariant
  }

  const duration = endTime - startTime;
  const noticeStartTime = noticeStart
    ? validTime(noticeStart, "noticeStart")
    : undefined;
  const noticeEndTime = noticeEnd ? validTime(noticeEnd, "noticeEnd") : endTime;

  return {
    elapsedPercent: clamp(((nowTime - startTime) / duration) * 100),
    ...(noticeStartTime === undefined
      ? {}
      : {
          noticeStartPercent: clamp(
            ((noticeStartTime - startTime) / duration) * 100,
          ),
          noticeEndPercent: clamp(
            ((noticeEndTime - startTime) / duration) * 100,
          ),
        }),
    daysElapsed: Math.max(0, Math.floor((nowTime - startTime) / DAY_IN_MS)),
    daysRemaining: Math.max(0, Math.ceil((endTime - nowTime) / DAY_IN_MS)),
    isNoticeOpen:
      noticeStartTime !== undefined &&
      nowTime >= noticeStartTime &&
      nowTime <= noticeEndTime,
    hasStarted: nowTime >= startTime,
    hasEnded: nowTime > endTime,
  };
}

/**
 * Every word the term bar says, in the reader's language. The kit carries no
 * English defaults and no plural rules; the application supplies these from
 * its catalog. Numbers and dates arrive already formatted with `locale`, except
 * day counts, which arrive as numbers so a message can pick its plural form.
 */
export interface TermBarMessages {
  /** "{percent} of the term elapsed, {days} days since start". */
  elapsed: (percent: string, days: number) => string;
  /** "{days} days remaining". */
  remaining: (days: number) => string;
  /** "Term ends {date}", for the accessible description. */
  endDate: (date: string) => string;
  /**
   * The visible end label, "Ends {date}", as the words before and after the
   * date. The sentence is one message in the catalog; it arrives split at the
   * date so compact layouts can hide the words and keep the `<time>`.
   */
  endsOn: Readonly<{ before: string; after: string }>;
  /** "Notice window {start} to {end}". */
  noticeWindow: (start: string, end: string) => string;
  renewalState: (state: RenewalState) => string;
  /** Joins the accessible description's sentences. */
  sentences: (parts: readonly string[]) => string;
}

export interface TermBarProps {
  label: string;
  start: Date;
  end: Date;
  /** Legacy alias for noticeStart. */
  noticeDate?: Date;
  noticeStart?: Date;
  noticeEnd?: Date;
  now: Date;
  renewalState?: RenewalState;
  variant?: TermBarVariant;
  /** The reader's formatting locale. Required: a default is how US dates reached every language. */
  locale: string;
  timeZone: string;
  messages: TermBarMessages;
  className?: string;
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(date);
}

function renewalTone(state: RenewalState): string {
  if (state === "expired" || state === "non-renewing") return "critical";
  if (state === "notice-open") return "attention";
  return "stable";
}

export function TermBar({
  label,
  start,
  end,
  noticeDate,
  noticeStart,
  noticeEnd,
  now,
  renewalState = "auto-renews",
  variant = "standard",
  locale,
  timeZone,
  messages: copy,
  className = "",
}: TermBarProps) {
  const resolvedNoticeStart = noticeStart ?? noticeDate;
  const progress = calculateTermProgress({
    start,
    end,
    now,
    ...(resolvedNoticeStart ? { noticeStart: resolvedNoticeStart } : {}),
    ...(noticeEnd ? { noticeEnd } : {}),
  });
  const endText = formatDate(end, locale, timeZone);
  const noticeStartText = resolvedNoticeStart
    ? formatDate(resolvedNoticeStart, locale, timeZone)
    : undefined;
  const noticeEndText = noticeStartText
    ? formatDate(noticeEnd ?? end, locale, timeZone)
    : undefined;
  const descriptionId = `term-${useId().replaceAll(":", "")}`;
  const renewalText = copy.renewalState(renewalState);
  const percentText = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Math.round(progress.elapsedPercent) / 100);
  const accessibleText = copy.sentences(
    [
      label,
      copy.elapsed(percentText, progress.daysElapsed),
      copy.remaining(progress.daysRemaining),
      copy.endDate(endText),
      noticeStartText && noticeEndText
        ? copy.noticeWindow(noticeStartText, noticeEndText)
        : undefined,
      renewalText,
    ].filter((part): part is string => Boolean(part)),
  );
  const noticeWidth =
    progress.noticeStartPercent === undefined ||
    progress.noticeEndPercent === undefined
      ? 0
      : Math.max(0, progress.noticeEndPercent - progress.noticeStartPercent);

  return (
    <div
      className={`cw-term cw-term--${variant} ${className}`.trim()}
      role="group"
      aria-labelledby={`${descriptionId}-label`}
      aria-describedby={descriptionId}
      data-notice-open={progress.isNoticeOpen || undefined}
      data-ended={progress.hasEnded || undefined}
    >
      <div className="cw-term__labels">
        <strong id={`${descriptionId}-label`}>{label}</strong>
        <span className="cw-term__date">
          {copy.endsOn.before ? (
            <span className="cw-term__date-prefix">{copy.endsOn.before}</span>
          ) : null}
          <time dateTime={end.toISOString()}>{endText}</time>
          {copy.endsOn.after ? (
            <span className="cw-term__date-prefix">{copy.endsOn.after}</span>
          ) : null}
        </span>
      </div>
      <div className="cw-term__track" aria-hidden="true">
        <div
          className="cw-term__elapsed"
          style={{ width: `${progress.elapsedPercent}%` }}
        />
        {progress.noticeStartPercent === undefined ? null : (
          <div
            className="cw-term__notice"
            style={{
              left: `${progress.noticeStartPercent}%`,
              width: `${noticeWidth}%`,
            }}
          />
        )}
        <span
          className="cw-term__today"
          style={{ left: `${progress.elapsedPercent}%` }}
        />
      </div>
      <div className="cw-term__meta" aria-hidden="true">
        <span>{percentText}</span>
        <span
          className={`cw-term__renewal cw-term__renewal--${renewalTone(renewalState)}`}
        >
          {renewalText}
        </span>
        <span>{copy.remaining(progress.daysRemaining)}</span>
      </div>
      <span className="cw-sr-only" id={descriptionId}>
        {accessibleText}
      </span>
    </div>
  );
}

export interface AccountTerm {
  id: string;
  label: string;
  start: Date;
  end: Date;
  noticeStart?: Date;
  noticeEnd?: Date;
  renewalState?: RenewalState;
}

export interface AccountTermRollupProps {
  label: string;
  terms: readonly AccountTerm[];
  now: Date;
  locale: string;
  timeZone: string;
  /** Every word, in the reader's language; see `TermBarMessages`. */
  messages: TermBarMessages;
  termCountLabel: (count: number) => string;
  nextEndLabel: string;
  noTermsLabel: string;
  className?: string;
}

/** A compact account-level summary followed by individually accessible terms. */
export function AccountTermRollup({
  label,
  terms,
  now,
  locale,
  timeZone,
  messages,
  termCountLabel,
  nextEndLabel,
  noTermsLabel,
  className = "",
}: AccountTermRollupProps) {
  const sortedTerms = [...terms].sort(
    (left, right) => left.end.getTime() - right.end.getTime(),
  );
  const nextTerm = sortedTerms[0];

  return (
    <section className={`cw-term-rollup ${className}`.trim()}>
      <header className="cw-term-rollup__header">
        <div>
          <h3>{label}</h3>
          <p>
            {terms.length === 0 ? noTermsLabel : termCountLabel(terms.length)}
          </p>
        </div>
        {nextTerm ? (
          <p className="cw-term-rollup__next">
            <span>{nextEndLabel}</span>
            <strong>{formatDate(nextTerm.end, locale, timeZone)}</strong>
          </p>
        ) : null}
      </header>
      {sortedTerms.length > 0 ? (
        <div className="cw-term-rollup__terms">
          {sortedTerms.map((term) => (
            <TermBar
              key={term.id}
              label={term.label}
              start={term.start}
              end={term.end}
              now={now}
              variant="compact"
              locale={locale}
              timeZone={timeZone}
              messages={messages}
              {...(term.noticeStart ? { noticeStart: term.noticeStart } : {})}
              {...(term.noticeEnd ? { noticeEnd: term.noticeEnd } : {})}
              {...(term.renewalState
                ? { renewalState: term.renewalState }
                : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
