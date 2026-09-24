import { revenueSources, type RevenueWorkspace } from "./model";

/**
 * The internal reporting view shown by an explicit demonstration deployment.
 *
 * These rows use the same grouped result shape and the same stored codes as
 * `core_revenue_forecast` and `core_arr_mrr` (`fil_one`, `merchant_of_record.v1`),
 * so the surface words them exactly as it words a production read. They
 * remain a deterministic demonstration ledger: no missing
 * service database is presented as a successful production read. The values
 * reconcile to the Meridian annual commitment used throughout the demo.
 */
export const demoRevenueWorkspace: RevenueWorkspace = {
  stages: [
    {
      stage: "committed_backlog",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "18480000",
      quoteCount: 0,
      orderCount: 1,
    },
    {
      stage: "pipeline",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "18480000",
      quoteCount: 1,
      orderCount: 0,
    },
  ],
  channels: [
    {
      channel: "direct",
      merchantOfRecord: "fil_one",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "7700000",
      orderCount: 1,
    },
  ],
  months: [
    {
      month: "2026-08-01",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "1540000",
      orderCount: 1,
    },
    {
      month: "2026-09-01",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "1540000",
      orderCount: 1,
    },
    {
      month: "2026-10-01",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "1540000",
      orderCount: 1,
    },
    {
      month: "2026-11-01",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "1540000",
      orderCount: 1,
    },
    {
      month: "2026-12-01",
      currency: "USD",
      revenueBasis: "gross",
      revenueMinor: "1540000",
      orderCount: 1,
    },
  ],
  recurring: [
    {
      currency: "USD",
      revenueBasis: "gross",
      methodologyVersion: "merchant_of_record.v1",
      mrrMinor: "1540000",
      arrMinor: "18480000",
      contractCount: 1,
    },
  ],
  forecastRowCount: 13,
  remainingBacklogRowCount: 5,
  recurringContractCount: 1,
  source: revenueSources.demo,
  readable: true,
};
