import { headers } from "next/headers";

import { readGeneratedExternalGates } from "@/src/features/contracts/external-gates-client";
import {
  externalGateFallback,
  externalGateRecords,
} from "@/src/features/surfaces/external-gate-records";
import { ExperiencePage } from "@/src/features/surfaces/experience-page";

export const dynamic = "force-dynamic";

async function configuredGateRecords() {
  const fallback = externalGateFallback(
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV,
  );
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return fallback;
  try {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get("cookie");
    const sessionFetch: typeof fetch = (input, init) => {
      const forwarded = new Headers(init?.headers);
      if (cookie) forwarded.set("cookie", cookie);
      return fetch(input, { ...init, headers: forwarded, cache: "no-store" });
    };
    const baseUrl = `${appUrl.replace(/\/$/, "")}/api`;
    return externalGateRecords(
      await readGeneratedExternalGates(baseUrl, sessionFetch),
    );
  } catch {
    return fallback;
  }
}

export default async function Page() {
  return (
    <ExperiencePage surface="gates" records={await configuredGateRecords()} />
  );
}
