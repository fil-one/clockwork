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
    throw new RangeError(`${name} must be a valid Date`);
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
    throw new RangeError("end must be after start");
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

export interface TermBarMessages {
  elapsed: (percent: number, days: number) => string;
  remaining: (days: number) => string;
  endDate: (date: string) => string;
  noticeWindow: (start: string, end: string) => string;
  renewalState: (state: RenewalState) => string;
}

const defaultMessages: TermBarMessages = {
  elapsed: (percent, days) => `${percent}% elapsed, ${days} days since start`,
  remaining: (days) => `${days} days remaining`,
  endDate: (date) => `Term ends ${date}`,
  noticeWindow: (start, end) => `Notice window ${start} through ${end}`,
  renewalState: (state) =>
    ({
      "auto-renews": "Automatic renewal",
      evergreen: "Evergreen term",
      "notice-open": "Notice window open",
      "non-renewing": "Will not renew",
      renewed: "Renewed",
      expired: "Expired",
    })[state],
};

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
  locale?: string;
  timeZone?: string;
  messages?: Partial<TermBarMessages>;
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
  locale = "en-US",
  timeZone = "UTC",
  messages,
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
  const copy = { ...defaultMessages, ...messages };
  const endText = formatDate(end, locale, timeZone);
  const noticeStartText = resolvedNoticeStart
    ? formatDate(resolvedNoticeStart, locale, timeZone)
    : undefined;
  const noticeEndText = noticeStartText
    ? formatDate(noticeEnd ?? end, locale, timeZone)
    : undefined;
  const descriptionId = `term-${useId().replaceAll(":", "")}`;
  const renewalText = copy.renewalState(renewalState);
  const accessibleText = [
    label,
    copy.elapsed(Math.round(progress.elapsedPercent), progress.daysElapsed),
    copy.remaining(progress.daysRemaining),
    copy.endDate(endText),
    noticeStartText && noticeEndText
      ? copy.noticeWindow(noticeStartText, noticeEndText)
      : undefined,
    renewalText,
  ]
    .filter(Boolean)
    .join(". ");
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
          <span className="cw-term__date-prefix">Ends </span>
          <time dateTime={end.toISOString()}>{endText}</time>
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
              insetInlineStart: `${progress.noticeStartPercent}%`,
              width: `${noticeWidth}%`,
            }}
          />
        )}
        <span
          className="cw-term__today"
          style={{ insetInlineStart: `${progress.elapsedPercent}%` }}
        />
      </div>
      <div className="cw-term__meta" aria-hidden="true">
        <span>{Math.round(progress.elapsedPercent)}%</span>
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
  locale?: string;
  timeZone?: string;
  termCountLabel?: (count: number) => string;
  nextEndLabel?: string;
  noTermsLabel?: string;
  className?: string;
}

/** A compact account-level summary followed by individually accessible terms. */
export function AccountTermRollup({
  label,
  terms,
  now,
  locale = "en-US",
  timeZone = "UTC",
  termCountLabel = (count) =>
    `${count} active ${count === 1 ? "term" : "terms"}`,
  nextEndLabel = "Next end date",
  noTermsLabel = "No active terms",
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
