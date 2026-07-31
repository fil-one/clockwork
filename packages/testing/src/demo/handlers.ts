import { delay, http, HttpResponse, type RequestHandler } from "msw";

import { DEMO_ORIGIN } from "./seed";

export const STATUS_ENDPOINTS = {
  core: "/v1/core/status",
  lifecycle: "/v1/lifecycle/status",
  system: "/v1/system/status",
} as const;

export type DemoStatusMode = "offline" | "ready";

export interface DemoStatusHandlerOptions {
  readonly baseUrl?: string;
  readonly latencyMs?: number;
  readonly mode?: DemoStatusMode;
}

/**
 * These are the only MSW commerce handlers in the experience fixture lane.
 * They exactly mirror the three reads in generated/openapi.json. Rich demo
 * data remains a presentation projection until Agents 2, 3, and 5 supply and
 * join generated commerce operations. Offline mode is a network failure and
 * therefore does not invent an error payload or undocumented status response.
 */
export function createDemoStatusHandlers(
  options: DemoStatusHandlerOptions = {},
): readonly RequestHandler[] {
  const baseUrl = (options.baseUrl ?? DEMO_ORIGIN).replace(/\/$/, "");
  const latencyMs = options.latencyMs ?? 0;
  const mode = options.mode ?? "ready";

  const respond = async <Lane extends "core" | "lifecycle" | "system">(
    lane: Lane,
  ) => {
    if (latencyMs > 0) await delay(latencyMs);
    if (mode === "offline") return HttpResponse.error();

    return HttpResponse.json({ lane, status: "ready" as const });
  };

  return [
    http.get(`${baseUrl}${STATUS_ENDPOINTS.core}`, () => respond("core")),
    http.get(`${baseUrl}${STATUS_ENDPOINTS.lifecycle}`, () =>
      respond("lifecycle"),
    ),
    http.get(`${baseUrl}${STATUS_ENDPOINTS.system}`, () => respond("system")),
  ];
}
