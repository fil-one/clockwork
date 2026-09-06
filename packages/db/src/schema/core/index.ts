import * as customerAcquisitionSchema from "./customer-acquisition";
export * from "./customer-acquisition";
import * as channelPolicySchema from "./channel-policy";
import * as priceBookScheduleSchema from "./price-book-schedules";
export * from "./price-book-schedules";
export * from "./channel-policy";
export * from "./finance";
export * from "./commercial-artifacts";
export * from "./tax";
export * from "./payg-offers";
export * from "./payg-billing";

import * as commercialArtifactSchema from "./commercial-artifacts";
import * as financeSchema from "./finance";
import * as taxSchema from "./tax";
import * as paygOfferSchema from "./payg-offers";
import * as trialSchema from "./trials";
import * as paygBillingSchema from "./payg-billing";

/** Core-finance owns this composition object; the shared runtime schema spreads it. */
export const coreSchema = {
  ...customerAcquisitionSchema,
  ...priceBookScheduleSchema,
  ...channelPolicySchema,
  ...financeSchema,
  ...commercialArtifactSchema,
  ...taxSchema,
  ...paygOfferSchema,
  ...paygBillingSchema,
  ...trialSchema,
};
export * from "./trials";
