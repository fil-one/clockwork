"use client";

import { useReportWebVitals } from "next/web-vitals";

export const performanceBudgets = {
  largestContentfulPaintMs: 2500,
  interactionToNextPaintMs: 200,
  cumulativeLayoutShift: 0.1,
  firstLoadJavaScriptKb: 180,
} as const;

interface WebVitalMetric {
  id: string;
  name: string;
  value: number;
}

export function WebVitals() {
  useReportWebVitals((metric: WebVitalMetric) => {
    window.dispatchEvent(
      new CustomEvent("clockwork:web-vital", {
        detail: { id: metric.id, name: metric.name, value: metric.value },
      }),
    );
  });
  return null;
}
