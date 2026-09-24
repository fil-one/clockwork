import type { MessageId } from "@/src/i18n";
import type { LaneStatus } from "@/src/features/contracts/status-client";

type Lane = LaneStatus["lane"];

/** The three status lanes the API reports, named for an operator. */
export const laneLabels: Readonly<Record<Lane, MessageId>> = {
  core: "operations.status.lane.core",
  lifecycle: "operations.status.lane.lifecycle",
  system: "operations.status.lane.system",
};

export const laneStatusLabels: Readonly<
  Record<LaneStatus["status"], MessageId>
> = {
  ready: "status.ready",
  degraded: "operations.status.state.degraded",
  unavailable: "operations.status.state.unavailable",
};

/** Keys of a lane's `details`, as the generated contract spells them. */
export const detailLabels: Readonly<Record<string, MessageId>> = {
  service: "operations.status.detail.service",
  stripeWebhook: "operations.status.detail.stripeWebhook",
  stripePayment: "operations.status.detail.stripePayment",
  artifactStorage: "operations.status.detail.artifactStorage",
  registration: "operations.status.detail.registration",
  partnerDomainOwnership: "operations.status.detail.partnerDomainOwnership",
  esign: "operations.status.detail.esign",
  provisioningWebhook: "operations.status.detail.provisioningWebhook",
  marketplaceWebhook: "operations.status.detail.marketplaceWebhook",
  supportWebhook: "operations.status.detail.supportWebhook",
  evidenceStorage: "operations.status.detail.evidenceStorage",
  externalGates: "operations.status.detail.externalGates",
  activationTestRunner: "operations.status.detail.activationTestRunner",
  workosWebhook: "operations.status.detail.workosWebhook",
};

/** Values a detail can take in the generated contract. */
export const detailValueLabels: Readonly<Record<string, MessageId>> = {
  database: "operations.status.value.connected",
  memory: "operations.status.value.memory",
  configured: "operations.status.value.configured",
  missing: "operations.status.value.missing",
};
