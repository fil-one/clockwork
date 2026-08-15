/**
 * The one checked-in dataset left on the internal lifecycle surfaces.
 *
 * Renewals, collections, provisioning and reports used to be served from
 * constants in this file. They are read from their projection channels now, so
 * those constants are gone rather than left available for a surface to fall
 * back onto.
 *
 * Migration matching has no channel, no read model and no candidate table:
 * `lifecycle_migration_runs` and `lifecycle_migration_matches` record decisions
 * already taken, and nothing persists the pending candidates the surface exists
 * to resolve. These records are kept as declared examples of that decision, and
 * `/internal/migrations` says on the page that they are examples.
 */

export interface MigrationCandidate {
  id: string;
  name: string;
  detail: string;
  confidence: number;
}

export interface MigrationRecord {
  id: string;
  sourceName: string;
  sourceSystem: string;
  legalEntity: string;
  externalReference: string;
  candidates: readonly MigrationCandidate[];
  evidence: string;
  owner: string;
}

export const illustrativeMigrations: readonly MigrationRecord[] = [
  {
    id: "MIG-EXAMPLE-016",
    sourceName: "Northstar Archive",
    sourceSystem: "Legacy billing US",
    legalEntity: "Northstar Archive Labs, Inc.",
    externalReference: "legacy-customer-1048",
    candidates: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Northstar Archive Labs",
        detail: "US · Direct buyer · northstar.example",
        confidence: 96,
      },
      {
        id: "4ef7bc88-805b-4aac-842c-21a3b5243c69",
        name: "Northstar Archive Labs UK",
        detail: "UK · Subsidiary · northstar.co.uk",
        confidence: 72,
      },
    ],
    evidence:
      "Tax name matches US entity; legacy email domain is shared by both candidates.",
    owner: "Example only",
  },
  {
    id: "MIG-EXAMPLE-021",
    sourceName: "Solace Public Records",
    sourceSystem: "Partner ledger",
    legalEntity: "Solace Public Records Authority",
    externalReference: "partner-ledger-0041",
    candidates: [
      {
        id: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
        name: "Solace Public Records",
        detail: "US · Distributor route · solace.example.gov",
        confidence: 99,
      },
    ],
    evidence: "Legal name, tax suffix, and invoice domain agree.",
    owner: "Example only",
  },
  {
    id: "MIG-EXAMPLE-024",
    sourceName: "Orion Geological Survey",
    sourceSystem: "Legacy CRM EU",
    legalEntity: "Orion Geological Survey GmbH",
    externalReference: "crm-eu-8821",
    candidates: [],
    evidence:
      "No current account shares the legal name, tax suffix, or verified domain.",
    owner: "Example only",
  },
] as const;
