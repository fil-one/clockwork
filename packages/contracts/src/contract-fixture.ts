// Test fixtures for the contract register and signing engine. Not exported
// from the package index; tests import this file directly.
import type {
  ContractInput,
  ContractRecord,
  ContractSigningRecord,
} from "./contract-register";

export const fixtureContractInput: ContractInput = {
  id: "019a44ac-0000-7000-8000-0000000000c1",
  counterpartyName: "Bluefin Data Co.",
  title: "",
  contractType: "customer_msa",
  paper: "theirs",
  status: "executed",
  effectiveDate: "2026-01-01",
  initialTermMonths: 12,
  autoRenew: true,
  renewalTermMonths: 12,
  noticePeriodDays: 60,
  valueMinor: 1_200_000,
  currency: "USD",
  pricingNotes: "",
  ownerName: "R.W. Holleman",
  internalNotes: "",
  tags: ["enterprise"],
};

export const fixtureContractRecord: ContractRecord = {
  ...fixtureContractInput,
  source: "register",
  executedAt: "2026-10-01T15:00:00.000Z",
  createdByName: "R.W. Holleman",
  createdAt: "2026-10-01T15:00:00.000Z",
  updatedAt: "2026-10-02T15:00:00.000Z",
  version: 2,
  termEndDate: "2026-12-31",
  renewalDate: "2027-01-01",
  noticeDeadline: "2026-11-01",
};

export const fixtureSigningRecord: ContractSigningRecord = {
  contractId: "019a44ac-0000-7000-8000-0000000000c2",
  templateId: "test-fixture",
  templateVersion: "fixture-1",
  templateHash: "b".repeat(64),
  documentName: "Fil One Engine Test Fixture - Bluefin Data Co.",
  input: { fixture_reference: "REF-7", fixture_tier: "beta", fixture_note: "" },
  counterpartySigner: {
    name: "Alex Example",
    email: "alex@example.com",
    title: "CEO",
  },
  countersigner: {
    id: "019a44ac-0000-7000-8000-000000000001",
    name: "James Kurz",
    email: "james@example.com",
    title: "CFO/CSO",
  },
  preparerId: "019a44ac-0000-7000-8000-0000000000c3",
  preparerName: "R.W. Holleman",
  approvalRequired: true,
  approvalState: "approved",
  approverName: "James Kurz",
  decidedAt: "2026-10-03T15:00:00.000Z",
  rejectionReason: null,
  state: "draft",
  providerId: null,
  testMode: true,
  error: null,
  createdAt: "2026-10-03T14:00:00.000Z",
  updatedAt: "2026-10-03T15:00:00.000Z",
  completedAt: null,
  version: 2,
};
