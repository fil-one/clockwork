import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Info,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";

export type WorkflowStepState = "complete" | "current" | "upcoming" | "error";

export interface WorkflowStep {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  state: WorkflowStepState;
  href?: string;
}

export interface WorkflowStepperProps {
  steps: readonly WorkflowStep[];
  label: string;
  orientation?: "responsive" | "horizontal" | "vertical";
  className?: string;
}

/** Progress navigation for long, review-heavy workflows. */
export function WorkflowStepper({
  steps,
  label,
  orientation = "responsive",
  className = "",
}: WorkflowStepperProps) {
  return (
    <nav
      className={`cw-workflow-stepper cw-workflow-stepper--${orientation} ${className}`.trim()}
      aria-label={label}
    >
      <ol>
        {steps.map((step, index) => {
          const copy = (
            <>
              <span className="cw-workflow-stepper__marker" aria-hidden="true">
                {step.state === "complete" ? <Check /> : index + 1}
              </span>
              <span className="cw-workflow-stepper__copy">
                <strong>{step.label}</strong>
                {step.description ? <span>{step.description}</span> : null}
              </span>
            </>
          );
          return (
            <li
              className={`cw-workflow-stepper__step cw-workflow-stepper__step--${step.state}`}
              key={step.id}
            >
              {step.href ? (
                <a
                  href={step.href}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  {copy}
                </a>
              ) : (
                <div
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  {copy}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type ReviewSummaryStatus = "complete" | "partial" | "warning" | "error";

export interface ReviewSummaryItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  status?: ReviewSummaryStatus;
  statusLabel?: ReactNode;
  action?: ReactNode;
}

export interface ReviewSummaryProps {
  title: ReactNode;
  description?: ReactNode;
  items: readonly ReviewSummaryItem[];
  actions?: ReactNode;
  status?: ReactNode;
  className?: string;
}

/** Compact, scan-friendly checkpoint before a workflow is submitted. */
export function ReviewSummary({
  title,
  description,
  items,
  actions,
  status,
  className = "",
}: ReviewSummaryProps) {
  return (
    <section className={`cw-review-summary ${className}`.trim()}>
      <header>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {status ? (
          <div className="cw-review-summary__status">{status}</div>
        ) : null}
      </header>
      <dl>
        {items.map((item) => (
          <div
            className={`cw-review-summary__item cw-review-summary__item--${item.status ?? "complete"}`}
            key={item.id}
          >
            <dt>{item.label}</dt>
            <dd>
              <span>{item.value}</span>
              {item.statusLabel ? (
                <small className="cw-review-summary__item-status">
                  {item.statusLabel}
                </small>
              ) : null}
              {item.action ? (
                <span className="cw-review-summary__item-action">
                  {item.action}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {actions ? <footer>{actions}</footer> : null}
    </section>
  );
}

export type InlineNoticeTone =
  "info" | "success" | "warning" | "danger" | "offline";

export interface InlineNoticeProps {
  title: ReactNode;
  description?: ReactNode;
  tone?: InlineNoticeTone;
  action?: ReactNode;
  dismiss?: ReactNode;
  icon?: ReactNode;
  live?: "off" | "polite" | "assertive";
  className?: string;
}

const noticeIcons = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
  offline: <WifiOff />,
} satisfies Record<InlineNoticeTone, ReactNode>;

/** Reusable action-oriented treatment for contextual and connectivity states. */
export function InlineNotice({
  title,
  description,
  tone = "info",
  action,
  dismiss,
  icon,
  live = "off",
  className = "",
}: InlineNoticeProps) {
  return (
    <div
      className={`cw-inline-notice cw-inline-notice--${tone} ${className}`.trim()}
      aria-live={live}
    >
      <span className="cw-inline-notice__icon" aria-hidden="true">
        {icon ?? noticeIcons[tone] ?? <CircleHelp />}
      </span>
      <div className="cw-inline-notice__copy">
        <strong>{title}</strong>
        {description ? <div>{description}</div> : null}
      </div>
      {action ? <div className="cw-inline-notice__action">{action}</div> : null}
      {dismiss ? (
        <div className="cw-inline-notice__dismiss">{dismiss}</div>
      ) : null}
    </div>
  );
}
