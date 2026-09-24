import type { TimelineItem } from "@clockwork/ui";

import type { ProjectedArtifact } from "@/src/features/experience-server/artifact-delivery-list";
import type { Translator } from "@/src/i18n";

import type { CommercialRecord, OrderLifecycleStatus } from "./model";

const orderProgress = {
  submitted: 0,
  accepted: 1,
  provisioning: 2,
  active: 3,
  amended: 3,
  completed: 4,
  terminated: 4,
} as const;

function progressFor(status: OrderLifecycleStatus | null): number | null {
  if (status === null) return null;
  if (status === "cancelled") return 0;
  return orderProgress[status];
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

/**
 * The term the record carries, or none. "Not recorded" is the placeholder the
 * production projection writes where an order has no term yet
 * (`NOT_RECORDED` in projection-presentation.ts); it is not a term.
 */
function recordedTerm(record: CommercialRecord): string | null {
  const term = record.term.trim();
  return term && term !== "Not recorded" ? term : null; // i18n-exempt: compares against the production projection's placeholder token, never rendered
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
  t: Translator,
): readonly TimelineItem[] {
  const notYetRecorded = t("customer.commercial.timeline.notYetRecorded");
  const lifecycleStatus = record.orderLifecycleStatus ?? null;
  const progress = progressFor(lifecycleStatus);
  const closed =
    lifecycleStatus === "completed" ||
    lifecycleStatus === "terminated" ||
    lifecycleStatus === "cancelled";
  const termEnded =
    lifecycleStatus === "completed" || lifecycleStatus === "terminated";
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
      title: t("status.order.submitted"),
      description:
        progress !== null
          ? t("customer.commercial.timeline.submitted")
          : notYetRecorded,
      status: stageStatus(0, progress, closed),
    },
    {
      id: "accepted",
      title: t("status.order.accepted"),
      description: acceptedRecorded
        ? orderForm
          ? t("customer.commercial.timeline.acceptedWithForm", {
              form: orderForm.label,
            })
          : t("customer.commercial.timeline.acceptedNoForm")
        : notYetRecorded,
      status: stageStatus(1, progress, closed),
    },
    {
      id: "provisioning",
      title: t("status.order.provisioning"),
      description: provisioningRecorded
        ? t("customer.commercial.timeline.provisioning")
        : notYetRecorded,
      status: stageStatus(2, progress, closed),
    },
    {
      id: "active",
      title: t("status.order.active"),
      description: activeRecorded
        ? t("customer.commercial.timeline.active")
        : notYetRecorded,
      status: stageStatus(3, progress, closed),
    },
    {
      id: "term-end",
      title: t("customer.commercial.valueLabel.termEnd"),
      description: term
        ? t(
            termEnded
              ? "customer.commercial.timeline.termEnded"
              : "customer.commercial.timeline.term",
            { term },
          )
        : notYetRecorded,
      status: stageStatus(4, progress, closed),
    },
  ];
}
