import "server-only";
import { randomUUID } from "node:crypto";
import {
  CustomerAcquisitionCommandSchema,
  ResolveAcquisitionCommandSchema,
  effectiveCustomerOffers,
  paygEvidenceHash,
  type CustomerAcquisitionCommand,
  type ResolveAcquisitionCommand,
  type CustomerAcquisitionView,
  type CustomerAcquisitionRequest,
} from "@clockwork/domain/core";
import { demoPersonas } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { currentDemoPaygPolicies } from "@/src/features/internal-ops/commercial-policies/demo-policies";
const prefix = "customer-acquisition-demo:";
function enabled() {
  if (!demoDeployIdentityEnabled(process.env))
    throw new Error("DEMO_ACQUISITION_UNAVAILABLE");
}
function persona(userId: string) {
  const found = Object.values(demoPersonas).find(
    (entry) => entry.userId === userId,
  );
  if (!found) throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
  return found;
}
function rows(state: DemoAdapterState) {
  return Object.entries(state.projectionOverrides)
    .filter(([key]) => key.startsWith(prefix))
    .map(
      ([, entry]) =>
        entry.data as unknown as CustomerAcquisitionRequest & {
          requestHash: string;
        },
    );
}
export class DemoCustomerAcquisitionRepository {
  constructor(
    private readonly store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {}
  async list(input: {
    userId: string;
    accountId: string;
    now: string;
  }): Promise<CustomerAcquisitionView> {
    enabled();
    const actor = persona(input.userId);
    if (actor.isInternalStaff || actor.selectedAccountId !== input.accountId)
      throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
    const state = await this.store.read();
    return {
      offers: effectiveCustomerOffers(
        currentDemoPaygPolicies(state, input.now),
        input.now,
      ),
      organizations: [
        {
          id: actor.organizationId,
          name: "Fictional customer organization",
          canRequest: ["owner", "admin"].includes(actor.role),
          providerMapped: false,
        },
      ],
      requests: rows(state).filter((row) => row.accountId === input.accountId),
    };
  }
  async listInternal(userId: string) {
    enabled();
    if (persona(userId).role !== "finance_approver")
      throw new Error("ACQUISITION_FINANCE_REQUIRED");
    return rows(await this.store.read());
  }
  async request(input: {
    command: CustomerAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    enabled();
    const command = CustomerAcquisitionCommandSchema.parse(input.command);
    const actor = persona(input.userId);
    if (
      actor.isInternalStaff ||
      actor.selectedAccountId !== command.accountId ||
      actor.organizationId !== command.organizationId ||
      !["owner", "admin"].includes(actor.role)
    )
      throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
    let result: CustomerAcquisitionRequest | undefined;
    await this.store.update((state) => {
      const current = rows(state);
      const hash = paygEvidenceHash({ command, userId: input.userId });
      const prior = current.find((row) => row.id === command.id);
      if (prior) {
        if (prior.requestHash !== hash)
          throw new Error("ACQUISITION_REPLAY_CONFLICT");
        result = prior;
        return state;
      }
      const offers = effectiveCustomerOffers(
        currentDemoPaygPolicies(state, input.now),
        input.now,
      );
      let offer;
      let trialId: string | null = null;
      let enrollmentId: string | null = null;
      if (command.kind === "cancel_payg") {
        const paid = current.find(
          (row) =>
            row.accountId === command.accountId &&
            row.organizationId === command.organizationId &&
            row.result?.kind === "payg" &&
            row.result.id === command.enrollmentId &&
            !row.result.endsAt,
        );
        if (!paid) throw new Error("ACQUISITION_ENROLLMENT_MISMATCH");
        offer = paid.offer;
        enrollmentId = command.enrollmentId;
      } else {
        offer = offers.find((row) => row.id === command.offerVersionId);
        if (
          !offer ||
          offer.rowVersion !== command.offerRowVersion ||
          offer.fingerprint !== command.offerFingerprint
        )
          throw new Error("ACQUISITION_OFFER_CHANGED");
        if (
          command.kind === "trial"
            ? !offer.notices.trialRequestsEnabled
            : !offer.notices.paygRequestsEnabled
        )
          throw new Error("ACQUISITION_KIND_UNAVAILABLE");
        if (
          command.kind === "trial" &&
          current.some(
            (row) =>
              row.organizationId === command.organizationId &&
              row.kind === "trial" &&
              row.status === "fulfilled",
          )
        )
          throw new Error("ACQUISITION_TRIAL_ALREADY_USED");
        if (command.kind === "convert_to_payg") {
          const trial = current.find(
            (row) =>
              row.accountId === command.accountId &&
              row.organizationId === command.organizationId &&
              row.result?.kind === "trial" &&
              row.result.id === command.trialId &&
              !row.result.convertedAt,
          );
          if (!trial) throw new Error("ACQUISITION_TRIAL_MISMATCH");
          trialId = command.trialId;
        }
      }
      if (
        current.some(
          (row) =>
            row.organizationId === command.organizationId &&
            row.status === "pending" &&
            (row.kind === command.kind ||
              (row.kind !== "cancel_payg" && command.kind !== "cancel_payg")),
        )
      )
        throw new Error("ACQUISITION_REQUEST_PENDING");
      result = {
        id: command.id,
        accountId: command.accountId,
        organizationId: command.organizationId,
        organizationName: "Fictional customer organization",
        kind: command.kind,
        status: "pending",
        rowVersion: 1,
        acceptedAt: input.now,
        offer,
        reason: command.kind === "cancel_payg" ? command.reason : "",
        resolutionReason: null,
        trialId,
        enrollmentId,
        result: null,
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${prefix}${command.id}`]: {
            version: 1,
            updatedAt: input.now,
            data: { ...result, requestHash: hash, simulated: true },
          },
        },
      };
    });
    if (!result) throw new Error("ACQUISITION_SAVE_FAILED");
    return result;
  }
  async resolve(input: {
    command: ResolveAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    enabled();
    if (persona(input.userId).role !== "finance_approver")
      throw new Error("ACQUISITION_FINANCE_REQUIRED");
    const command = ResolveAcquisitionCommandSchema.parse(input.command);
    let result: CustomerAcquisitionRequest | undefined;
    await this.store.update((state) => {
      const current = rows(state);
      const prior = current.find((row) => row.id === command.id);
      if (
        !prior ||
        prior.status !== "pending" ||
        prior.rowVersion !== command.expectedRowVersion
      )
        throw new Error("ACQUISITION_REQUEST_CHANGED");
      result = {
        ...prior,
        status: command.decision,
        rowVersion: prior.rowVersion + 1,
        resolutionReason: command.reason,
      };
      const overrides = { ...state.projectionOverrides };
      if (command.decision === "fulfilled") {
        if (prior.kind === "trial") {
          const id = randomUUID();
          result.trialId = id;
          result.result = {
            kind: "trial",
            id,
            startsAt: input.now,
            endsAt: new Date(
              Date.parse(input.now) + prior.offer.trial.durationDays * 86400000,
            ).toISOString(),
            convertedAt: null,
            billingAuthority: null,
          };
        } else if (prior.kind === "cancel_payg") {
          const paid = current.find(
            (row) =>
              row.result?.id === prior.enrollmentId &&
              row.result.kind === "payg" &&
              !row.result.endsAt,
          );
          if (!paid?.result)
            throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
          result.result = { ...paid.result, endsAt: input.now };
          overrides[`${prefix}${paid.id}`] = {
            version: paid.rowVersion,
            updatedAt: input.now,
            data: { ...paid, result: result.result },
          };
        } else {
          const id = randomUUID();
          result.enrollmentId = id;
          result.result = {
            kind: "payg",
            id,
            startsAt: input.now,
            endsAt: null,
            convertedAt: null,
            billingAuthority: "fictional_demo",
          };
          if (prior.kind === "convert_to_payg") {
            const trial = current.find(
              (row) =>
                row.result?.id === prior.trialId &&
                row.result.kind === "trial" &&
                !row.result.convertedAt,
            );
            if (!trial?.result)
              throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
            overrides[`${prefix}${trial.id}`] = {
              version: trial.rowVersion,
              updatedAt: input.now,
              data: {
                ...trial,
                result: { ...trial.result, convertedAt: input.now },
              },
            };
          }
        }
      }
      overrides[`${prefix}${prior.id}`] = {
        version: result.rowVersion,
        updatedAt: input.now,
        data: {
          ...result,
          requestHash: prior.requestHash,
          simulated: true,
          resolvedBy: input.userId,
        },
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: overrides,
      };
    });
    if (!result) throw new Error("ACQUISITION_SAVE_FAILED");
    return result;
  }
}
