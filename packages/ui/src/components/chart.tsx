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
  emptyLabel?: string;
  tableLabel?: string;
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
  emptyLabel = "No chart data",
  tableLabel = "View data table",
  className = "",
}: MetricChartProps) {
  const chartId = `chart-${useId().replaceAll(":", "")}`;
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
            aria-label={`${title}. ${data.map((datum) => `${datum.label}: ${formatValue(datum.value)}`).join(", ")}`}
          >
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
                  x={index * barWidth + barWidth * 0.18}
                  y={point.y}
                  width={barWidth * 0.64}
                  height={Math.max(1, height - point.y)}
                  rx="3"
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
                <th scope="col">Period</th>
                <th scope="col">Value</th>
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
