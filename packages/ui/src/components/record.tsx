import type { ReactNode } from "react";

export interface ResponsiveRecordField {
  id: string;
  label: ReactNode;
  value: ReactNode;
  numeric?: boolean;
  priority?: "primary" | "secondary";
}

export interface ResponsiveRecordProps {
  title: ReactNode;
  href?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  fields?: readonly ResponsiveRecordField[];
  status?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

/** A dense desktop row that becomes a labeled, glanceable card on narrow screens. */
export function ResponsiveRecord({
  title,
  href,
  description,
  eyebrow,
  fields = [],
  status,
  leading,
  actions,
  selected = false,
  disabled = false,
  loading = false,
  className = "",
}: ResponsiveRecordProps) {
  return (
    <article
      className={`cw-responsive-record ${selected ? "cw-responsive-record--selected" : ""} ${loading ? "cw-responsive-record--loading" : ""} ${className}`.trim()}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      data-selected={selected || undefined}
    >
      {leading ? (
        <div className="cw-responsive-record__leading">{leading}</div>
      ) : null}
      <div className="cw-responsive-record__identity">
        {eyebrow ? (
          <div className="cw-responsive-record__eyebrow">{eyebrow}</div>
        ) : null}
        <h3>{href && !disabled ? <a href={href}>{title}</a> : title}</h3>
        {description ? (
          <div className="cw-responsive-record__description">{description}</div>
        ) : null}
      </div>
      {fields.length ? (
        <dl className="cw-responsive-record__fields">
          {fields.map((field) => (
            <div
              className={`cw-responsive-record__field cw-responsive-record__field--${field.priority ?? "secondary"}`}
              data-numeric={field.numeric || undefined}
              key={field.id}
            >
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {status ? (
        <div className="cw-responsive-record__status">{status}</div>
      ) : null}
      {actions ? (
        <div className="cw-responsive-record__actions">{actions}</div>
      ) : null}
    </article>
  );
}
