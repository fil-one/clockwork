import { useId } from "react";

export interface ChartDatum {
  label: string;
  value: number;
}

export interface ChartGeometry {
  points: readonly { x: number; y: number }[];
  path: string;
  min: number;
  max: number;
}

export function calculateChartGeometry(
  data: readonly ChartDatum[],
  width: number,
  height: number,
): ChartGeometry {
  if (data.length === 0) return { points: [], path: "", min: 0, max: 0 };
  const values = data.map((datum) => datum.value);
  const min = Math.min(0, ...values);
  const maxValue = Math.max(...values);
  const max = maxValue === min ? min + 1 : maxValue;
  const range = max - min;
  const denominator = Math.max(1, data.length - 1);
  const points = data.map((datum, index) => ({
    x: (index / denominator) * width,
    y: height - ((datum.value - min) / range) * height,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  return { points, path, min, max };
}

export interface MetricChartProps {
  title: string;
  description?: string;
  data: readonly ChartDatum[];
  formatValue: (value: number) => string;
  type?: "line" | "bar";
  height?: number;
  /**
   * The reader's words. The kit carries no English defaults: the caller
   * supplies every label, and the locale the point list is joined with.
   */
  locale: string;
  emptyLabel: string;
  tableLabel: string;
  periodLabel: string;
  valueLabel: string;
  /** One data point for the accessible summary, e.g. "Jul: 72 TB". */
  formatPoint: (label: string, value: string) => string;
  className?: string;
}

/** A deliberately small chart with an always-available semantic data table. */
export function MetricChart({
  title,
  description,
  data,
  formatValue,
  type = "line",
  height = 176,
  locale,
  emptyLabel,
  tableLabel,
  periodLabel,
  valueLabel,
  formatPoint,
  className = "",
}: MetricChartProps) {
  const chartId = `chart-${useId().replaceAll(":", "")}`;
  const gradientId = `${chartId}-fill`;
  const width = 640;
  const geometry = calculateChartGeometry(data, width, height);
  const barWidth = width / Math.max(1, data.length);

  return (
    <figure
      className={`cw-chart cw-chart--${type} ${className}`.trim()}
      aria-labelledby={`${chartId}-title`}
      aria-describedby={description ? `${chartId}-description` : undefined}
    >
      <figcaption className="cw-chart__caption">
        <div>
          <h3 id={`${chartId}-title`}>{title}</h3>
          {description ? (
            <p id={`${chartId}-description`}>{description}</p>
          ) : null}
        </div>
        {data.length > 0 ? (
          <strong>{formatValue(data[data.length - 1]?.value ?? 0)}</strong>
        ) : null}
      </figcaption>
      {data.length === 0 ? (
        <div className="cw-chart__empty">{emptyLabel}</div>
      ) : (
        <div className="cw-chart__plot">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            // The figure is already named by its title; the plot lists the points.
            aria-label={new Intl.ListFormat(locale, {
              type: "unit",
              style: "short",
            }).format(
              data.map((datum) =>
                formatPoint(datum.label, formatValue(datum.value)),
              ),
            )}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                {type === "line" ? (
                  <>
                    <stop
                      className="cw-chart__gradient-start"
                      offset="0"
                      stopOpacity="0.32"
                    />
                    <stop
                      className="cw-chart__gradient-end"
                      offset="1"
                      stopOpacity="0.02"
                    />
                  </>
                ) : (
                  <>
                    <stop className="cw-chart__gradient-bar-start" offset="0" />
                    <stop className="cw-chart__gradient-bar-end" offset="1" />
                  </>
                )}
              </linearGradient>
            </defs>
            <line
              className="cw-chart__axis"
              x1="0"
              y1={height - 1}
              x2={width}
              y2={height - 1}
            />
            {type === "line" ? (
              <>
                <path
                  className="cw-chart__area"
                  style={{ fill: `url(#${gradientId})` }}
                  d={`${geometry.path} L${width},${height} L0,${height} Z`}
                />
                <path className="cw-chart__line" d={geometry.path} />
                {geometry.points.map((point, index) => (
                  <circle
                    className="cw-chart__point"
                    cx={point.x}
                    cy={point.y}
                    r="4"
                    key={data[index]?.label}
                  />
                ))}
              </>
            ) : (
              geometry.points.map((point, index) => (
                <rect
                  className="cw-chart__bar"
                  style={{ fill: `url(#${gradientId})` }}
                  x={index * barWidth + barWidth * 0.18}
                  y={point.y}
                  width={barWidth * 0.64}
                  height={Math.max(1, height - point.y)}
                  rx="4"
                  key={data[index]?.label}
                />
              ))
            )}
          </svg>
          <div className="cw-chart__labels" aria-hidden="true">
            <span>{data[0]?.label}</span>
            <span>{data[data.length - 1]?.label}</span>
          </div>
        </div>
      )}
      {data.length > 0 ? (
        <details className="cw-chart__data">
          <summary>{tableLabel}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{periodLabel}</th>
                <th scope="col">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((datum) => (
                <tr key={datum.label}>
                  <th scope="row">{datum.label}</th>
                  <td>{formatValue(datum.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}
