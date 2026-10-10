import "server-only";
import {
  DatabaseIndicativePriceBookReader,
  PricingScenarioRepository,
  type IndicativePriceBookRecord,
  type PricingScenarioScope,
} from "@clockwork/db";
import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  ContractAccessError,
  contractStaff,
  type ContractStaffSession,
} from "../contracts/server";
import { demoPricingScenarios } from "./demo-scenarios";
import { loadIndicativePriceBookRecords } from "./server-books";
import type { ScenarioPanelState } from "./scenarios";

/**
 * A seller reaches their own scenarios; a commerce administrator reads,
 * overwrites and deletes every one. `sales:read` is enough for the writes
 * because they reach only the caller's own rows. The service role does not
 * narrow rows, so this is the guard.
 */
export function scenarioScope(
  session: ContractStaffSession,
): PricingScenarioScope {
  return session.roles.includes("commerce_admin")
    ? { kind: "all" }
    : { kind: "own", ownerId: session.userId };
}

/**
 * The books a demo example is priced from: the same read the pricing page
 * makes, through the service database when there is one.
 */
export function demoScenarioBooks(locale: string) {
  const database = getOptionalServiceDatabase();
  return loadIndicativePriceBookRecords(
    database ? new DatabaseIndicativePriceBookReader(database) : undefined,
    { locale },
  );
}

/** The guided demo and a deployment without a database keep no scenarios. */
export function scenarioRepository() {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const database = getOptionalServiceDatabase();
  if (!database) throw new Error("PRICING_SCENARIOS_UNAVAILABLE");
  return new PricingScenarioRepository(database);
}

/** The UTC day the indicative price book read uses for books in force. */
export const scenarioToday = (now = new Date()) =>
  now.toISOString().slice(0, 10);

/**
 * The page's scenario section: the caller's list and, when `openId` names
 * one they may reach, that scenario. The guided demo keeps no scenarios and
 * offers fictional examples priced from `books`, the read the page prices
 * with, so the builder and the summary agree.
 * Refusals become states the page words plainly; the calculator above keeps
 * working whatever happens here.
 */
export async function loadScenarioPanel(
  openId: string | undefined,
  books: Promise<{
    books: readonly IndicativePriceBookRecord[];
    readAt: string;
  }>,
): Promise<ScenarioPanelState> {
  if (explicitDemoIdentityEnabled()) {
    const read = await books;
    const examples = demoPricingScenarios(read.books, read.readAt.slice(0, 10));
    return {
      kind: "demo",
      examples,
      opened: examples.find(({ id }) => id === openId) ?? null,
    };
  }
  if (!getOptionalServiceDatabase()) return { kind: "unavailable" };
  try {
    const session = await contractStaff(
      "sales:read",
      getRequestCommerceSession,
    );
    const repository = scenarioRepository();
    const scope = scenarioScope(session);
    const [scenarios, opened] = await Promise.all([
      repository.list(scope),
      openId && /^[0-9a-f-]{36}$/i.test(openId)
        ? repository.get(openId, scope).catch((error: unknown) => {
            if (
              error instanceof Error &&
              error.message === "PRICING_SCENARIO_NOT_FOUND"
            )
              return null;
            throw error;
          })
        : Promise.resolve(null),
    ]);
    return {
      kind: "ready",
      scenarios,
      opened,
      seesAll: scope.kind === "all",
    };
  } catch (error) {
    if (error instanceof ContractAccessError)
      return error.code === "CONTRACT_MFA_REQUIRED"
        ? { kind: "mfa" }
        : { kind: "unavailable" };
    console.error("pricing scenarios: page load failed", error);
    return { kind: "error" };
  }
}
