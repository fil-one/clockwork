import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export type ApplicationState =
  | "loading"
  | "empty"
  | "partial"
  | "optimistic"
  | "success"
  | "validation"
  | "permission"
  | "stale"
  | "offline"
  | "recoverable-error"
  | "fatal-error";

export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";

function stateTone(state: ApplicationState): StateTone {
  if (state === "success") return "success";
  if (state === "validation" || state === "fatal-error") return "danger";
  if (
    state === "partial" ||
    state === "stale" ||
    state === "offline" ||
    state === "recoverable-error"
  )
    return "warning";
  if (state === "optimistic" || state === "loading") return "info";
  return "neutral";
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  label = "Loading",
  decorative = false,
  className = "",
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  label?: string;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`cw-skeleton ${className}`.trim()}
      style={{ width, height }}
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {decorative ? null : <span className="cw-sr-only">{label}</span>}
    </div>
  );
}

export function SkeletonGroup({
  label,
  rows = 3,
  className = "",
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`cw-skeleton-group ${className}`.trim()} role="status">
      <span className="cw-sr-only">{label}</span>
      <Skeleton width="38%" height="0.75rem" decorative />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          height={index === rows - 1 ? "2.75rem" : "4rem"}
          decorative
          key={index}
        />
      ))}
    </div>
  );
}

export interface ApplicationStatePanelProps {
  state: ApplicationState;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  details?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** One semantic treatment for all page and card states; copy remains product-owned. */
export function ApplicationStatePanel({
  state,
  title,
  description,
  action,
  secondaryAction,
  details,
  compact = false,
  className = "",
}: ApplicationStatePanelProps) {
  const tone = stateTone(state);
  const live = state === "optimistic" || state === "success";
  const alert = state === "validation" || state.includes("error");
  return (
    <section
      className={`cw-state cw-state--${state} cw-state--${tone} ${compact ? "cw-state--compact" : ""} ${className}`.trim()}
      role={alert ? "alert" : live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      aria-busy={state === "loading" || state === "optimistic" || undefined}
    >
      <span className="cw-state__mark" aria-hidden="true" />
      <div className="cw-state__body">
        <h2>{title}</h2>
        <div className="cw-state__description">{description}</div>
        {details ? <div className="cw-state__details">{details}</div> : null}
        {action || secondaryAction ? (
          <div className="cw-state__actions">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <ApplicationStatePanel
      state="empty"
      title={title}
      description={description}
      {...(action ? { action } : {})}
      {...(secondaryAction ? { secondaryAction } : {})}
    />
  );
}

export interface StateBannerProps {
  tone?: StateTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  dismiss?: ReactNode;
  live?: "off" | "polite" | "assertive";
  className?: string;
}

export function StateBanner({
  tone = "info",
  title,
  description,
  action,
  icon,
  dismiss,
  live = "off",
  className = "",
}: StateBannerProps) {
  return (
    <aside
      className={`cw-banner cw-banner--${tone} ${className}`.trim()}
      aria-live={live}
    >
      <span className="cw-banner__icon" aria-hidden="true">
        {icon ?? <span className="cw-banner__mark" />}
      </span>
      <div className="cw-banner__copy">
        <strong>{title}</strong>
        {description ? <div>{description}</div> : null}
      </div>
      {action ? <div className="cw-banner__action">{action}</div> : null}
      {dismiss ? <div className="cw-banner__dismiss">{dismiss}</div> : null}
    </aside>
  );
}

export function LiveRegion({
  children,
  priority = "polite",
  atomic = true,
}: {
  children: ReactNode;
  priority?: "polite" | "assertive";
  atomic?: boolean;
}) {
  return (
    <div className="cw-sr-only" aria-live={priority} aria-atomic={atomic}>
      {children}
    </div>
  );
}

export interface ValidationIssue {
  id: string;
  label: ReactNode;
  href?: string;
}

export function ValidationSummary({
  title,
  issues,
  className = "",
}: {
  title: ReactNode;
  issues: readonly ValidationIssue[];
  className?: string;
}) {
  return (
    <section
      className={`cw-validation-summary ${className}`.trim()}
      role="alert"
      tabIndex={-1}
    >
      <h2>{title}</h2>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id}>
            {issue.href ? <a href={issue.href}>{issue.label}</a> : issue.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OptimisticStatus({
  pending,
  pendingLabel,
  settledLabel,
  className = "",
}: {
  pending: boolean;
  pendingLabel: ReactNode;
  settledLabel: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`cw-optimistic ${pending ? "cw-optimistic--pending" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="cw-optimistic__mark" aria-hidden="true" />
      {pending ? pendingLabel : settledLabel}
    </span>
  );
}

export interface ProgressStep {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  state: "complete" | "current" | "upcoming" | "error";
}

export function ProgressSteps({
  steps,
  label,
  className = "",
}: {
  steps: readonly ProgressStep[];
  label: string;
  className?: string;
}) {
  return (
    <ol className={`cw-steps ${className}`.trim()} aria-label={label}>
      {steps.map((step, index) => (
        <li
          className={`cw-steps__item cw-steps__item--${step.state}`}
          key={step.id}
        >
          <span className="cw-steps__number" aria-hidden="true">
            {step.state === "complete" ? <Check /> : index + 1}
          </span>
          <span>
            <strong
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {step.label}
            </strong>
            {step.description ? <span>{step.description}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`cw-badge cw-badge--${tone} ${className}`.trim()}>
      {children}
    </span>
  );
}
