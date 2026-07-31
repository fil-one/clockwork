import * as foundationSchema from "../schema";
import { coreSchema } from "./core";
import { lifecycleSchema } from "./lifecycle";
import { systemSchema } from "./system";

export * from "../schema";
export * from "./core";
export * from "./lifecycle";
export * from "./system";

/** Drizzle consumes this stable composition; lanes only edit their own object. */
export const runtimeSchema = {
  ...foundationSchema,
  ...coreSchema,
  ...lifecycleSchema,
  ...systemSchema,
};
