import type { CommerceDocumentInput } from "@clockwork/documents";
import { describe, expect, it } from "vitest";

import {
  artifactSourceHash,
  verifyResolvedArtifactSource,
} from "./artifact-sources";

const party = {
  legalName: "Example Archive Ltd.",
  address: {
    line1: "1 Evidence Way",
    locality: "Wilmington",
    postalCode: "19801",
    countryCode: "US",
  },
} as const;

function source() {
  const document: CommerceDocumentInput = {
    kind: "direct_quote",
    documentId: "Q-1",
    version: "4",
    issuedAt: "2026-07-31T16:00:00.000Z",
    locale: "en-US",
    issuer: party,
    recipient: party,
    quoteNumber: "Q-1-R4",
    validUntil: "2026-08-31",
    currency: "USD",
    lineItems: [
      {
        id: "line-1",
        description: "Archive service",
        amount: { currency: "USD", minorUnits: "10000" },
      },
    ],
    totals: {
      subtotal: { currency: "USD", minorUnits: "10000" },
      total: { currency: "USD", minorUnits: "10000" },
    },
    paymentTerms: "Due on receipt",
    verification: { objectVersion: "4", recordHash: "0".repeat(64) },
  };
  const binding = {
    kind: document.kind,
    subjectType: "quote",
    subjectId: "90000000-0000-4000-8000-000000000001",
    sourceVersion: "4",
    document,
  } as const;
  const sourceHash = artifactSourceHash(binding);
  return {
    kind: document.kind,
    subjectType: binding.subjectType,
    subjectId: binding.subjectId,
    sourceVersion: binding.sourceVersion,
    sourceHash,
    input: {
      ...document,
      verification: { ...document.verification, recordHash: sourceHash },
    },
  };
}

describe("artifact source binding", () => {
  it("accepts an exact canonical identity, version, and document binding", () => {
    expect(() => verifyResolvedArtifactSource(source())).not.toThrow();
  });

  it("rejects corrupt facts and stale versions even when the stored hash is unchanged", () => {
    const exact = source();
    expect(() =>
      verifyResolvedArtifactSource({
        ...exact,
        input: {
          ...exact.input,
          totals: {
            ...exact.input.totals,
            total: { currency: "USD", minorUnits: "999999" },
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "ARTIFACT_SOURCE_CORRUPT" }),
    );
    expect(() =>
      verifyResolvedArtifactSource({ ...exact, sourceVersion: "5" }),
    ).toThrowError(
      expect.objectContaining({ code: "ARTIFACT_SOURCE_CORRUPT" }),
    );
  });
});
