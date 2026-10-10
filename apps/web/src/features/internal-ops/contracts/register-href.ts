import type { Route } from "next";
import type { ContractListQuery } from "@clockwork/contracts";

/** The register URL for a query, without defaults, so links stay short. */
export function registerHref(query: Partial<ContractListQuery>): Route {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.window) params.set("window", String(query.window));
  if (query.mine) params.set("mine", "1");
  if (query.sort && query.sort !== "updated") params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/internal/contracts?${search}` : "/internal/contracts";
}
