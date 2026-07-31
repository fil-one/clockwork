import { headers } from "next/headers";

import { readGeneratedExternalGates } from "@/src/features/contracts/external-gates-client";
import {
  fallbackGates,
  type GateRecord,
} from "@/src/features/internal-ops/administration-safety/data";
import {
  GateRegister,
  presentGeneratedGate,
} from "@/src/features/internal-ops/administration-safety/gates";
import { getRouteRoles } from "@/src/features/shell/route-session";

export const dynamic = "force-dynamic";

async function configuredGateRecords(): Promise<{
  gates: readonly GateRecord[];
  source: "System gate registry" | "Fail-closed operational fallback";
}> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl)
    return { gates: fallbackGates, source: "Fail-closed operational fallback" };
  try {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get("cookie");
    const sessionFetch: typeof fetch = (input, init) => {
      const forwarded = new Headers(init?.headers);
      if (cookie) forwarded.set("cookie", cookie);
      return fetch(input, { ...init, headers: forwarded, cache: "no-store" });
    };
    const baseUrl = `${appUrl.replace(/\/$/, "")}/api`;
    return {
      gates: (await readGeneratedExternalGates(baseUrl, sessionFetch)).map(
        presentGeneratedGate,
      ),
      source: "System gate registry",
    };
  } catch {
    return { gates: fallbackGates, source: "Fail-closed operational fallback" };
  }
}

export default async function Page() {
  const [roles, configured] = await Promise.all([
    getRouteRoles("internal"),
    configuredGateRecords(),
  ]);
  return (
    <GateRegister
      roles={roles}
      gates={configured.gates}
      source={configured.source}
    />
  );
}
