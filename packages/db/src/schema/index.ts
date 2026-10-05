import * as foundationSchema from "../schema";
import { coreSchema } from "./core";
import { lifecycleSchema } from "./lifecycle";
import { systemSchema } from "./system";
import { experienceSchema } from "./experience";
import { mndaSchema } from "./mnda";
import { contractsSchema } from "./contracts";

export * from "../schema";
export * from "./core";
export * from "./lifecycle";
export * from "./system";
export * from "./experience";
export * from "./mnda";
export * from "./contracts";

/** Drizzle consumes this stable composition; lanes only edit their own object. */
export const runtimeSchema: typeof foundationSchema &
  typeof coreSchema &
  typeof lifecycleSchema &
  typeof systemSchema &
  typeof experienceSchema &
  typeof mndaSchema &
  typeof contractsSchema = {
  ...foundationSchema,
  ...coreSchema,
  ...lifecycleSchema,
  ...systemSchema,
  ...experienceSchema,
  ...mndaSchema,
  ...contractsSchema,
};
