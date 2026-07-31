export * from "./finance";
export * from "./commercial-artifacts";

import * as commercialArtifactSchema from "./commercial-artifacts";
import * as financeSchema from "./finance";

/** Core-finance owns this composition object; the shared runtime schema spreads it. */
export const coreSchema = { ...financeSchema, ...commercialArtifactSchema };
