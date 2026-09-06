import * as foundationSchema from "../schema";
import { coreSchema } from "./core";
import { lifecycleSchema } from "./lifecycle";
import { systemSchema } from "./system";
import { experienceSchema } from "./experience";

export * from "../schema";
export * from "./core";
export * from "./lifecycle";
export * from "./system";
export * from "./experience";

/** Drizzle consumes this stable composition; lanes only edit their own object. */
export const runtimeSchema: typeof foundationSchema &
  typeof coreSchema &
  typeof lifecycleSchema &
  typeof systemSchema &
  typeof experienceSchema = {
  ...foundationSchema,
  ...coreSchema,
  ...lifecycleSchema,
  ...systemSchema,
  ...experienceSchema,
};
