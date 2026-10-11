import "server-only";

import type { McpTool } from "./tool";
import { homeSummary, whoami } from "./tools/account";
import { contractTools } from "./tools/contracts";
import { handoffTools, libraryTools } from "./tools/handoffs";
import { mndaTools } from "./tools/mndas";
import { notificationTools } from "./tools/notifications";
import { partnerTools } from "./tools/partners";
import { pricingTools } from "./tools/pricing";

/**
 * Every MCP tool, in the order clients list them. Approvals, team and role
 * changes, capability switches, notification and MNDA settings, the owner
 * console, assisted sessions and anything behind the recent-MFA window have
 * no tool: they stay in the app.
 */
export const mcpTools: readonly McpTool[] = [
  whoami,
  homeSummary,
  ...mndaTools,
  ...contractTools,
  ...partnerTools,
  ...pricingTools,
  ...handoffTools,
  ...notificationTools,
  ...libraryTools,
];
