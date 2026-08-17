import type { TimelineItem } from "@clockwork/ui";

import type { ProjectedArtifact } from "@/src/features/experience-server/artifact-delivery-list";

import type { CommercialRecord } from "./model";

const NOT_YET_RECORDED = "Not yet recorded.";

const orderProgress = {
  submitted: 0,
  accepted: 1,
  provisioning: 2,
  active: 3,
  amended: 3,
  completed: 4,
  terminated: 4,
} as const;

function progressFor(status: string): number | null {
  if (status === "cancelled") return 0;
  return status in orderProgress
    ? orderProgress[status as keyof typeof orderProgress]
    : null;
}

function stageStatus(
  stage: number,
  progress: number | null,
  terminal: boolean,
): NonNullable<TimelineItem["status"]> {
  if (progress === null || progress < stage) return "upcoming";
  if (progress > stage || terminal) return "complete";
  return "current";
}

function recordedTerm(record: CommercialRecord): string | null {
  const term = record.term.trim();
  return term && term.toLowerCase() !== "not recorded" ? term : null;
}

/**
 * Derives only what the order detail already knows.
 *
 * The collection projection carries the current lifecycle state and a display
 * term, while the sibling artifact read carries attached document identity.
 * It carries no provisioning inventory, notification receipt, or per-stage
 * event timestamps, so this model never manufactures any of those fields.
 */
export function orderTimeline(
  record: CommercialRecord,
  artifacts: readonly ProjectedArtifact[],
): readonly TimelineItem[] {
  const progress = progressFor(record.status);
  const closed =
    record.status === "completed" ||
    record.status === "terminated" ||
    record.status === "cancelled";
  const termEnded =
    record.status === "completed" || record.status === "terminated";
  const orderForm = artifacts.find(
    (artifact) => artifact.kind === "order_form" && artifact.state === "stored",
  );
  const acceptedRecorded = progress !== null && progress >= 1;
  const provisioningRecorded = progress !== null && progress >= 2;
  const activeRecorded = progress !== null && progress >= 3;
  const term = recordedTerm(record);

  return [
    {
      id: "submitted",
      title: "Submitted",
      description:
        progress !== null
          ? "Order submission is recorded in the current projection."
          : NOT_YET_RECORDED,
      status: stageStatus(0, progress, closed),
    },
    {
      id: "accepted",
      title: "Accepted",
      description: acceptedRecorded
        ? orderForm
          ? `Acceptance is recorded. Pinned order form: ${orderForm.label}.`
          : `Acceptance is recorded. Stored order form: ${NOT_YET_RECORDED}`
        : NOT_YET_RECORDED,
      status: stageStatus(1, progress, closed),
    },
    {
      id: "provisioning",
      title: "Provisioning",
      description: provisioningRecorded
        ? "Provisioning state is recorded in the current projection."
        : NOT_YET_RECORDED,
      status: stageStatus(2, progress, closed),
    },
    {
      id: "active",
      title: "Active",
      description: activeRecorded
        ? "Active service state is recorded in the current projection."
        : NOT_YET_RECORDED,
      status: stageStatus(3, progress, closed),
    },
    {
      id: "term-end",
      title: "Term end",
      description: term
        ? `${termEnded ? "Order end is recorded. " : ""}Recorded term: ${term}.`
        : NOT_YET_RECORDED,
      status: stageStatus(4, progress, closed),
    },
  ];
}
