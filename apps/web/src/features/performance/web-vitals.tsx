"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useMemo } from "react";

import { BrowserOpenTelemetry } from "./client-telemetry";

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
  rating?: string;
  navigationType?: string;
}

export function WebVitals({ traceparent }: { traceparent?: string }) {
  const telemetry = useMemo(
    () =>
      new BrowserOpenTelemetry({
        ...(traceparent ? { parentTraceparent: traceparent } : {}),
        environment: process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? "unknown",
        serviceVersion:
          process.env.NEXT_PUBLIC_CLOCKWORK_RELEASE_SHA ?? "unknown",
      }),
    [traceparent],
  );

  useEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    telemetry.span("document.load", {
      "app.route": window.location.href,
      "navigation.type": navigation?.type ?? "navigate",
    });
    const reportError = (event: ErrorEvent) => {
      telemetry.span("browser.error", {
        "app.route": window.location.href,
        "error.type":
          event.error instanceof Error ? event.error.name : "ErrorEvent",
      });
    };
    const reportRejection = (event: PromiseRejectionEvent) => {
      telemetry.span("browser.unhandled_rejection", {
        "app.route": window.location.href,
        "error.type":
          event.reason instanceof Error
            ? event.reason.name
            : "UnhandledRejection",
      });
    };
    window.addEventListener("error", reportError);
    window.addEventListener("unhandledrejection", reportRejection);
    return () => {
      window.removeEventListener("error", reportError);
      window.removeEventListener("unhandledrejection", reportRejection);
    };
  }, [telemetry]);

  useReportWebVitals((metric: WebVitalMetric) => {
    telemetry.metric(`web_vital.${metric.name.toLowerCase()}`, metric.value, {
      "app.route": window.location.href,
      "web_vital.name": metric.name,
      "web_vital.rating": metric.rating ?? "unknown",
      "navigation.type": metric.navigationType ?? "unknown",
    });
    window.dispatchEvent(
      new CustomEvent("clockwork:web-vital", {
        detail: { id: metric.id, name: metric.name, value: metric.value },
      }),
    );
  });
  return null;
}
