import type { CSSProperties, ReactNode } from "react";

export function Skeleton({
  width = "100%",
  height = "1rem",
  label = "Loading",
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  label?: string;
}) {
  return (
    <div
      className="cw-skeleton"
      style={{ width, height }}
      role="status"
      aria-label={label}
    >
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="cw-empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`cw-badge cw-badge--${tone}`}>{children}</span>;
}
