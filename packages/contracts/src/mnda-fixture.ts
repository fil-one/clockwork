import type { MndaInput, MndaRecord, MndaSigner } from "./mnda";

export const fixtureSigner: MndaSigner = {
  id: "019a44ac-0000-7000-8000-000000000001",
  name: "James Kurz",
  email: "james@example.com",
  title: "CFO/CSO",
  active: true,
  isDefault: true,
};
export const fixtureInput: MndaInput = {
  id: "019a44ac-0000-7000-8000-000000000002",
  company: "Example Corporation",
  shortName: "Example",
  entityDescription: "Delaware corporation",
  streetAddress: "123 Example Street",
  locality: "New York, NY 10001",
  noticesContact: "Alex Example",
  noticesEmail: "legal@example.com",
  signerName: "Alex Example",
  signerEmail: "alex@example.com",
  signerTitle: "CEO",
  countersignerId: fixtureSigner.id,
  effectiveDate: "2026-10-02",
};
export const fixtureRecord: MndaRecord = {
  id: fixtureInput.id,
  input: fixtureInput,
  countersigner: fixtureSigner,
  ownerId: "019a44ac-0000-7000-8000-000000000003",
  ownerName: "Revenue operator",
  state: "draft",
  providerId: null,
  testMode: true,
  templateHash: "a".repeat(64),
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  completedAt: null,
  error: null,
  version: 1,
};
