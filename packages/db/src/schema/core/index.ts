export * from "./finance";

import * as financeSchema from "./finance";

/** Core-finance owns this composition object; the shared runtime schema spreads it. */
export const coreSchema = financeSchema;
