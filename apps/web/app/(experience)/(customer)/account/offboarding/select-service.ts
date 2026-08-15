import type { ProjectionRecord } from "@/src/features/experience-server/model";

type Data = Readonly<Record<string, unknown>>;

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Server-projected records carry the raw aggregate under `authoritative`. */
function authoritative(data: Data): Data {
  const value = data.authoritative;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}

/**
 * `recordRoute` builds a detail path as `/<channel>/<encoded recordKey>`, so a
 * payload that states one for the orders channel states an order record key
 * and nothing else. Anchored, and with no `/`, `?` or `#` admitted in the
 * segment, so a longer path or a path carrying its own query is not read as a
 * reference.
 */
const ORDER_DETAIL_ROUTE = /^\/orders\/([^/?#]+)$/;

function orderKeyFromRoute(value: string | undefined): string | undefined {
  const match = value ? ORDER_DETAIL_ROUTE.exec(value) : null;
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * The order an offboarding deep link names.
 *
 * Offboarding is order-scoped: `POST /v1/lifecycle/terminations` takes an
 * `orderId`, and the list on this surface is the customer's own open orders.
 * The one link into it is "Request offboarding" on a service detail page,
 * which carries that service's projection `recordKey` -- a `services` record,
 * not an order -- so the reference has to be resolved to an order before
 * anything can be preselected. Resolving it is what makes the destination open
 * against the record the reader came from; before this it did not, and the
 * page rendered identically with the parameter and without it.
 *
 * Two references are accepted, in this order:
 *
 * 1. An open order named directly by its own `recordKey`.
 * 2. A record on the customer `services` channel, resolved to the order it
 *    names. A service projection states that order in one of two shapes and
 *    both are read, because both are shapes this surface is served: the
 *    materialized payload carries the termination's authoritative `orderId`,
 *    which is an order aggregate id; the fixture payload carries its own
 *    `href` to the order's detail route, which spells an order record key.
 *
 * Anything else -- an unknown reference, a service whose order is closed or
 * outside this account, a service that names no order at all -- resolves to
 * `undefined`, and the surface preselects its default first open order exactly
 * as it does with no parameter. Nothing is invented and nothing is guessed.
 */
export function requestedOrderAggregateId(
  requested: string | undefined,
  openOrders: readonly ProjectionRecord[],
  services: readonly ProjectionRecord[],
): string | undefined {
  if (!requested) return undefined;
  const direct = openOrders.find((order) => order.recordKey === requested);
  if (direct) return direct.aggregateId;

  const service = services.find((record) => record.recordKey === requested);
  if (!service) return undefined;

  const orderId = text(authoritative(service.data), "orderId");
  if (orderId) {
    const byAggregate = openOrders.find(
      (order) => order.aggregateId === orderId,
    );
    if (byAggregate) return byAggregate.aggregateId;
  }

  const orderKey = orderKeyFromRoute(text(service.data, "href"));
  if (!orderKey) return undefined;
  return openOrders.find((order) => order.recordKey === orderKey)?.aggregateId;
}
