import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Tooltip } from "./tooltip";

export type RiskLevel = "none" | "low" | "moderate" | "high" | "critical";

export function RiskIndicator({
  level,
  label,
  detail,
  compact = false,
  className = "",
}: {
  level: RiskLevel;
  label: string;
  detail?: string;
  compact?: boolean;
  className?: string;
}) {
  const chip = (
    <span
      className={`cw-risk cw-risk--${level} ${compact ? "cw-risk--compact" : ""} ${className}`.trim()}
      // A chip carrying detail takes focus so a keyboard reaches the tooltip.
      // Radix keeps the span a span, so the tab stop has to be set here.
      {...(detail ? { tabIndex: 0 } : {})}
    >
      <span className="cw-risk__mark" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
  if (!detail) return chip;
  // The level and the label carry the signal on their own. `detail` explains
  // the level: the tooltip reaches hover, keyboard focus, and touch, and the
  // hidden copy keeps it readable without focusing the chip.
  return (
    <>
      <Tooltip trigger={chip}>{detail}</Tooltip>
      <span className="cw-sr-only">. {detail}</span>
    </>
  );
}

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  change?: ReactNode;
  trend?: "up" | "down" | "flat";
  tone?: "neutral" | "positive" | "attention" | "critical";
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function StatTile({
  label,
  value,
  detail,
  change,
  trend = "flat",
  tone = "neutral",
  icon,
  action,
  className = "",
}: StatTileProps) {
  return (
    <article
      className={`cw-stat cw-stat--${tone} ${className}`.trim()}
      data-trend={trend}
    >
      <header className="cw-stat__header">
        <span className="cw-stat__label">{label}</span>
        {icon ? (
          <span className="cw-stat__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </header>
      <div className="cw-stat__value">{value}</div>
      {detail || change ? (
        <footer className="cw-stat__footer">
          {change ? (
            <span className="cw-stat__change">
              <span className="cw-stat__trend" aria-hidden="true">
                {trend === "up" ? (
                  <ArrowUpRight />
                ) : trend === "down" ? (
                  <ArrowDownRight />
                ) : (
                  <Minus />
                )}
              </span>
              {change}
            </span>
          ) : null}
          {detail ? <span className="cw-stat__detail">{detail}</span> : null}
        </footer>
      ) : null}
      {action ? <div className="cw-stat__action">{action}</div> : null}
    </article>
  );
}

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp?: ReactNode;
  status?: "complete" | "current" | "upcoming" | "failed";
  meta?: ReactNode;
  action?: ReactNode;
}

export function Timeline({
  items,
  label,
  className = "",
}: {
  items: readonly TimelineItem[];
  label: string;
  className?: string;
}) {
  return (
    <ol className={`cw-timeline ${className}`.trim()} aria-label={label}>
      {items.map((item) => (
        <li
          className={`cw-timeline__item cw-timeline__item--${item.status ?? "upcoming"}`}
          key={item.id}
        >
          <span className="cw-timeline__marker" aria-hidden="true" />
          <div className="cw-timeline__body">
            <div className="cw-timeline__heading">
              <strong>{item.title}</strong>
              {item.timestamp ? (
                <span className="cw-timeline__time">{item.timestamp}</span>
              ) : null}
            </div>
            {item.description ? (
              <div className="cw-timeline__description">{item.description}</div>
            ) : null}
            {item.meta ? (
              <div className="cw-timeline__meta">{item.meta}</div>
            ) : null}
            {item.action ? (
              <div className="cw-timeline__action">{item.action}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface DocumentCardProps {
  title: ReactNode;
  type: ReactNode;
  documentId?: ReactNode;
  version?: ReactNode;
  updated?: ReactNode;
  status?: ReactNode;
  summary?: ReactNode;
  preview?: ReactNode;
  actions?: ReactNode;
  href?: string;
  className?: string;
}

export function DocumentCard({
  title,
  type,
  documentId,
  version,
  updated,
  status,
  summary,
  preview,
  actions,
  href,
  className = "",
}: DocumentCardProps) {
  const titleContent = href ? <a href={href}>{title}</a> : title;
  return (
    <article className={`cw-document-card ${className}`.trim()}>
      <div className="cw-document-card__preview" aria-hidden="true">
        {preview ?? <span className="cw-document-card__page" />}
      </div>
      <div className="cw-document-card__body">
        <div className="cw-document-card__topline">
          <span className="cw-eyebrow">{type}</span>
          {status ? <span>{status}</span> : null}
        </div>
        <h3>{titleContent}</h3>
        {summary ? (
          <div className="cw-document-card__summary">{summary}</div>
        ) : null}
        {documentId || version || updated ? (
          <dl className="cw-document-card__meta">
            {documentId ? (
              <div>
                <dt className="cw-sr-only">Document ID</dt>
                <dd>{documentId}</dd>
              </div>
            ) : null}
            {version ? (
              <div>
                <dt className="cw-sr-only">Version</dt>
                <dd>{version}</dd>
              </div>
            ) : null}
            {updated ? (
              <div>
                <dt className="cw-sr-only">Updated</dt>
                <dd>{updated}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {actions ? (
          <div className="cw-document-card__actions">{actions}</div>
        ) : null}
      </div>
    </article>
  );
}

export interface QueueRowProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  metadata?: ReactNode;
  status?: ReactNode;
  risk?: ReactNode;
  time?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
}

export function QueueRow({
  title,
  description,
  eyebrow,
  metadata,
  status,
  risk,
  time,
  actions,
  selected = false,
  className = "",
}: QueueRowProps) {
  return (
    <article
      className={`cw-queue-row ${selected ? "cw-queue-row--selected" : ""} ${className}`.trim()}
      data-selected={selected || undefined}
    >
      <div className="cw-queue-row__signal">{risk ?? status}</div>
      <div className="cw-queue-row__body">
        {eyebrow ? <div className="cw-eyebrow">{eyebrow}</div> : null}
        <h3>{title}</h3>
        {description ? (
          <div className="cw-queue-row__description">{description}</div>
        ) : null}
        {metadata ? (
          <div className="cw-queue-row__metadata">{metadata}</div>
        ) : null}
      </div>
      <div className="cw-queue-row__aside">
        {time ? <div className="cw-queue-row__time">{time}</div> : null}
        {actions ? (
          <div className="cw-queue-row__actions">{actions}</div>
        ) : null}
      </div>
    </article>
  );
}

export function DescriptionList({
  items,
  columns = 2,
  className = "",
}: {
  items: readonly { term: ReactNode; detail: ReactNode }[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={`cw-description-list ${className}`.trim()}
      style={{ "--cw-description-columns": columns } as CSSProperties}
    >
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.term}</dt>
          <dd>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CapacityMeter({
  label,
  value,
  max,
  valueLabel,
  threshold,
  thresholdLabel,
  className = "",
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  threshold?: number;
  thresholdLabel?: string;
  className?: string;
}) {
  const safeMax = Math.max(1, max);
  const safeValue = Math.max(0, Math.min(safeMax, value));
  const percentage = (safeValue / safeMax) * 100;
  const thresholdPercentage =
    threshold === undefined
      ? undefined
      : Math.max(0, Math.min(100, (threshold / safeMax) * 100));
  return (
    <div className={`cw-capacity ${className}`.trim()}>
      <div className="cw-capacity__labels">
        <span>{label}</span>
        <strong>{valueLabel}</strong>
      </div>
      <div
        className="cw-capacity__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        aria-valuetext={valueLabel}
      >
        <span
          className="cw-capacity__value"
          style={{ width: `${percentage}%` }}
        />
        {thresholdPercentage === undefined ? null : (
          <span
            className="cw-capacity__threshold"
            style={{ insetInlineStart: `${thresholdPercentage}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {thresholdLabel ? (
        <span className="cw-capacity__threshold-label">{thresholdLabel}</span>
      ) : null}
    </div>
  );
}
