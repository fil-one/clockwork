import {
  capacitySeries,
  spendSeries,
  usageSeries,
} from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

const labels = Array.from({ length: 6 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, index + 1, 1)),
  ),
);

export function DataChart({ kind }: { kind: "usage" | "spend" | "capacity" }) {
  const values =
    kind === "usage"
      ? usageSeries
      : kind === "spend"
        ? spendSeries
        : capacitySeries;
  const title =
    kind === "usage"
      ? t("chart.usage")
      : kind === "spend"
        ? t("chart.spend")
        : t("chart.capacity");
  const maximum = Math.max(...values);
  const points = values.map((value, index) => ({
    label: labels[index] ?? "",
    value,
    x: 18 + index * 52,
    y: 118 - (value / maximum) * 92,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <figure className="data-chart">
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 300 140"
        role="img"
        aria-labelledby={`${kind}-chart-title ${kind}-chart-description`}
      >
        <title id={`${kind}-chart-title`}>{title}</title>
        <desc id={`${kind}-chart-description`}>
          {points.map((point) => `${point.label}: ${point.value}`).join("; ")}
        </desc>
        <path className="chart-grid" d="M18 26H278 M18 72H278 M18 118H278" />
        <path className="chart-area" d={`${path} L278,118 L18,118 Z`} />
        <path className="chart-line" d={path} />
        {points.map((point) => (
          <g key={point.label}>
            <circle className="chart-dot" cx={point.x} cy={point.y} r="3" />
            <text x={point.x} y="136" textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>{t("chart.axis.month")}</th>
            <th>{t("chart.axis.value")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th>{point.label}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
