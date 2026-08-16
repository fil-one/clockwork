export * from "./finance";
export * from "./commercial-artifacts";
export * from "./tax";

import * as commercialArtifactSchema from "./commercial-artifacts";
import * as financeSchema from "./finance";
import * as taxSchema from "./tax";

/** Core-finance owns this composition object; the shared runtime schema spreads it. */
export const coreSchema = {
  ...financeSchema,
  ...commercialArtifactSchema,
  ...taxSchema,
};
