/**
 * The legacy-caller exemptions of every lane, for eslint.config.mjs and
 * legacy-callers.test.ts. Foundation-owned; lanes edit only their own file.
 */
import partner from "./partner.mjs";
import customer from "./customer.mjs";
import experience from "./experience.mjs";
import adminPricing from "./admin-pricing.mjs";
import adminGovernance from "./admin-governance.mjs";
import operations from "./operations.mjs";
import platform from "./platform.mjs";
import demo from "./demo.mjs";

export const legacyCallers = {
  partner,
  customer,
  experience,
  adminPricing,
  adminGovernance,
  operations,
  platform,
  demo,
};

/** Every exempted path for one exemption kind, across lanes. */
export function legacyFiles(kind) {
  return Object.values(legacyCallers).flatMap((entry) => entry[kind]);
}
