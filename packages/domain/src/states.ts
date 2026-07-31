export type QuoteStatus =
  "draft" | "issued" | "accepted" | "expired" | "superseded" | "rejected";
export type OrderStatus =
  | "submitted"
  | "accepted"
  | "provisioning"
  | "active"
  | "amended"
  | "completed"
  | "cancelled"
  | "terminated";

const quoteTransitions = {
  draft: ["issued", "rejected"],
  issued: ["accepted", "expired", "superseded", "rejected"],
  accepted: [],
  expired: [],
  superseded: [],
  rejected: [],
} as const satisfies Record<QuoteStatus, readonly QuoteStatus[]>;

const orderTransitions = {
  submitted: ["accepted", "cancelled"],
  accepted: ["provisioning", "cancelled"],
  provisioning: ["active", "cancelled"],
  active: ["amended", "completed", "terminated"],
  amended: ["active", "completed", "terminated"],
  completed: [],
  cancelled: [],
  terminated: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

export function transitionQuote(
  from: QuoteStatus,
  to: QuoteStatus,
): QuoteStatus {
  if (!(quoteTransitions[from] as readonly QuoteStatus[]).includes(to))
    throw new Error(`Invalid quote transition: ${from} -> ${to}`);
  return to;
}

export function transitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): OrderStatus {
  if (!(orderTransitions[from] as readonly OrderStatus[]).includes(to))
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  return to;
}
