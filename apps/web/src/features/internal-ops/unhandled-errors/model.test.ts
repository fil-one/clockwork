import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  causeDiscardSite,
  diagnosableCount,
  eventTypeFromFragments,
  excludedFailureShapedEventTypes,
  failureWriterRoots,
  groupIncidents,
  isContainmentReference,
  isFailureShapedEventType,
  providerMessageProvenance,
  runtimeFailureEventTypes,
  runtimeFailureWriters,
  type RuntimeFailureIncident,
} from "./model";

function incident(
  overrides: Partial<RuntimeFailureIncident> = {},
): RuntimeFailureIncident {
  return {
    auditEventId: "11111111-1111-4111-8111-111111111111",
    eventType: "workflow.task.dead_lettered",
    aggregateType: "workflow_run",
    aggregateId: "22222222-2222-4222-8222-222222222222",
    accountId: null,
    requestId: "workflow-finish:key",
    occurredAt: "2026-08-01T00:00:00.000Z",
    boundary: null,
    safeCode: "WORKFLOW_PERMANENT_FAILURE",
    taskIdentifier: "task",
    outboxMessageId: null,
    diagnosis: { kind: "code_only", discardedAt: { kind: "unknown" } },
    decisionCount: 0,
    latestDecision: null,
    latestDecisionReason: null,
    latestDecisionAt: null,
    ...overrides,
  };
}

/**
 * The catalogue is the one part of this feature that could be satisfied by
 * declaring something. An event type listed here that nothing appends is a page
 * promising an operator a failure signal the tree never produces, so the list
 * is bound to the modules that write it rather than to another list.
 */
describe("the runtime failure catalogue is bound to writers", () => {
  /**
   * The suite runs from the package and, through turbo, from the workspace
   * root. A root that resolved to nothing would make the binding vacuous, so a
   * miss throws instead of skipping.
   */
  const root = (() => {
    for (const candidate of [
      path.join(process.cwd(), "..", ".."),
      process.cwd(),
    ])
      if (existsSync(path.join(candidate, "packages", "db", "src")))
        return candidate;
    throw new Error(
      `Could not locate the workspace root from ${process.cwd()}; the writer binding would pass without reading anything.`,
    );
  })();

  it("names a writer for every event type", () => {
    expect(Object.keys(runtimeFailureWriters).sort()).toEqual(
      [...runtimeFailureEventTypes].sort(),
    );
  });

  /**
   * The binding that matters. An earlier version asserted only that the named
   * module contained the declared fragment strings, with nothing tying a
   * fragment to an event type -- so the phantom entry "billing.invoice.exploded"
   * with the fragment '"failed"' passed, because almost any module contains
   * that token. Reconstructing the event type from the fragments is the form
   * that refuses it.
   */
  it("reconstructs each event type from the fragments its writer declares", () => {
    for (const eventType of runtimeFailureEventTypes) {
      const writer = runtimeFailureWriters[eventType];
      expect(
        eventTypeFromFragments(writer.fragments),
        `${eventType}: fragments ${JSON.stringify(writer.fragments)} do not spell it`,
      ).toBe(eventType);
    }
  });

  it("finds every declared fragment in the module named as its writer", () => {
    for (const eventType of runtimeFailureEventTypes) {
      const writer = runtimeFailureWriters[eventType];
      const source = readFileSync(path.join(root, writer.module), "utf8");
      for (const fragment of writer.fragments)
        expect(
          source.includes(fragment),
          `${eventType}: ${writer.module} does not contain ${fragment}`,
        ).toBe(true);
    }
  });

  /**
   * The declaration attack that used to succeed, run as a test rather than
   * described in a comment.
   */
  it("refuses fragments that do not spell the event type they are filed under", () => {
    expect(eventTypeFromFragments(['"failed"'])).toBe("failed");
    expect(eventTypeFromFragments(['"failed"'])).not.toBe(
      "billing.invoice.exploded",
    );
    // A composed writer still resolves, and only to what it composes.
    expect(
      eventTypeFromFragments([
        "`experience.projection_action.${status}`",
        '"failed"',
      ]),
    ).toBe("experience.projection_action.failed");
    expect(
      eventTypeFromFragments([
        "`experience.projection_action.${status}`",
        '"succeeded"',
      ]),
    ).toBe("experience.projection_action.succeeded");
    // An unresolved placeholder, an unquoted fragment and a stray third
    // fragment all yield nothing rather than something that might match.
    expect(
      eventTypeFromFragments(["`experience.projection_action.${status}`"]),
    ).toBeNull();
    expect(eventTypeFromFragments(["failed"])).toBeNull();
    expect(eventTypeFromFragments(['"a"', '"b"', '"c"'])).toBeNull();
  });

  /**
   * A fragment list that could not fail is not a binding. This asserts the
   * check reads the file it names, by looking for a string that is not there.
   */
  it("fails when a declared fragment is absent from the writer", () => {
    const source = readFileSync(
      path.join(
        root,
        runtimeFailureWriters["workflow.task.dead_lettered"].module,
      ),
      "utf8",
    );
    expect(source.includes('"workflow.task.never_written"')).toBe(false);
  });
});

/**
 * The half the catalogue was missing, and the reason this surface was refuted.
 *
 * The binding above proves that everything listed is real. It cannot prove that
 * everything real is listed, and `lifecycle.provider_effect.dead_lettered` --
 * the only durable audit event on the permanent provisioning-provider failure
 * path -- was absent from the list while the page's empty state told operators
 * that nothing had failed.
 */
describe("the catalogue accounts for every failure-shaped event type", () => {
  const root = (() => {
    for (const candidate of [
      path.join(process.cwd(), "..", ".."),
      process.cwd(),
    ])
      if (existsSync(path.join(candidate, "packages", "db", "src")))
        return candidate;
    throw new Error(
      `Could not locate the workspace root from ${process.cwd()}; the completeness check would pass without reading anything.`,
    );
  })();

  function sourceFiles(directory: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourceFiles(full));
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (/\.(test|spec|integration\.test)\.tsx?$/.test(entry.name)) continue;
      found.push(full);
    }
    return found;
  }

  const dottedLiteral = /"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g;

  const scanned = (() => {
    const found = new Map<string, string>();
    for (const relativeRoot of failureWriterRoots) {
      const absolute = path.join(root, relativeRoot);
      expect(
        existsSync(absolute),
        `${relativeRoot} does not exist; the scan would read nothing`,
      ).toBe(true);
      for (const file of sourceFiles(absolute)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(dottedLiteral)) {
          const literal = match[1];
          if (literal === undefined) continue;
          if (!isFailureShapedEventType(literal)) continue;
          if (!found.has(literal))
            found.set(literal, path.relative(root, file));
        }
      }
    }
    return found;
  })();

  /** A scan that found nothing would make every assertion below vacuous. */
  it("reads a non-trivial number of failure-shaped literals", () => {
    expect(scanned.size).toBeGreaterThanOrEqual(
      runtimeFailureEventTypes.length,
    );
  });

  it("catalogues or excludes every failure-shaped event type in the tree", () => {
    const catalogued = new Set<string>(runtimeFailureEventTypes);
    const unaccounted = [...scanned.entries()].filter(
      ([literal]) =>
        !catalogued.has(literal) &&
        !Object.hasOwn(excludedFailureShapedEventTypes, literal),
    );
    expect(
      unaccounted,
      `Add each of these to runtimeFailureEventTypes, or to excludedFailureShapedEventTypes with the reason it is not a runtime failure: ${unaccounted
        .map(([literal, file]) => `${literal} (${file})`)
        .join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The exclusion list is the part that can silence this check, so it is held
   * to the tree too: an exclusion whose writer is gone is a line nobody will
   * ever reread.
   */
  it("keeps no exclusion whose event type is no longer written", () => {
    const stale = Object.keys(excludedFailureShapedEventTypes).filter(
      (literal) => !scanned.has(literal),
    );
    expect(
      stale,
      `These exclusions no longer match anything in the tree and should be deleted: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("finds the provider-effect path that the first version of this page missed", () => {
    expect(scanned.has("lifecycle.provider_effect.dead_lettered")).toBe(true);
    expect(runtimeFailureEventTypes as readonly string[]).toContain(
      "lifecycle.provider_effect.dead_lettered",
    );
  });
});

describe("what a containment reference may be", () => {
  /**
   * The refusals the previous pattern made. Each of these is what an operator
   * actually pastes into a field labelled "Gate key, deploy revision or
   * ticket", and each was refused.
   */
  it("admits a ticket URL, a phrase with spaces and a gate key", () => {
    expect(isContainmentReference("https://tickets.test/browse?id=4421")).toBe(
      true,
    );
    expect(isContainmentReference("gate EXT-PROVIDER-01")).toBe(true);
    expect(isContainmentReference("EXT-PROVIDER-01")).toBe(true);
    expect(isContainmentReference("deploy/2026-08-14.3")).toBe(true);
  });

  it("still refuses a second statement, markup and an unbounded string", () => {
    expect(isContainmentReference("gate key; drop table")).toBe(false);
    expect(isContainmentReference("<script>alert(1)</script>")).toBe(false);
    expect(isContainmentReference('say "no"')).toBe(false);
    expect(isContainmentReference("line\nbreak")).toBe(false);
    expect(isContainmentReference("x".repeat(201))).toBe(false);
    expect(isContainmentReference("x".repeat(200))).toBe(true);
  });
});

describe("cause availability", () => {
  it("names the write site that discarded the cause, per writer", () => {
    expect(causeDiscardSite("workflow.task.dead_lettered")).toMatchObject({
      column: "workflow_runs.last_error",
    });
    expect(causeDiscardSite("lifecycle.effect.dead_lettered")).toMatchObject({
      column: "provider_operations.last_error",
    });
    expect(causeDiscardSite("order.provisioning_dead_lettered")).toMatchObject({
      field: "lastError.message",
    });
  });

  /**
   * Every catalogued type gets a site named for it, rather than falling through
   * to the generic sentence. A new entry with no branch here would put "the
   * writer of this event records a code and no message" under a row whose
   * writer this feature has never looked at.
   */
  it("names a site for every catalogued event type", () => {
    expect(causeDiscardSite("nothing.this.surface.reads")).toEqual({
      kind: "unknown",
    });
    for (const eventType of runtimeFailureEventTypes)
      expect(
        causeDiscardSite(eventType).kind,
        `${eventType} falls through to the generic discard sentence`,
      ).not.toBe("unknown");
  });

  /**
   * The provider-effect rows are the ones whose cause is reachable but not on
   * the audit row, so their discard site has to say where it does survive.
   */
  it("says where a provider-effect cause survives", () => {
    const site = causeDiscardSite("lifecycle.provider_effect.dead_lettered");
    expect(site).toEqual({
      kind: "coerced_attempt_survives",
      column: "provider_operations.last_error",
      module: "packages/db/src/repositories/workflows/lifecycle.ts",
    });
  });

  it("counts only signatures whose latest failure kept a message", () => {
    const signatures = groupIncidents([
      incident(),
      incident({
        auditEventId: "33333333-3333-4333-8333-333333333333",
        eventType: "order.provisioning_dead_lettered",
        aggregateType: "order",
        safeCode: null,
        diagnosis: {
          kind: "provider_message",
          message: "Region eu-west-1 rejected the tenant",
          provenance: providerMessageProvenance.commandAttempt,
        },
      }),
    ]);
    expect(signatures).toHaveLength(2);
    expect(diagnosableCount(signatures)).toBe(1);
  });
});

describe("grouping to first and last occurrence", () => {
  it("keeps one signature per event, code and aggregate", () => {
    const signatures = groupIncidents([
      incident({ occurredAt: "2026-08-03T00:00:00.000Z" }),
      incident({
        auditEventId: "44444444-4444-4444-8444-444444444444",
        occurredAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.occurrences).toBe(2);
    expect(signatures[0]?.firstSeenAt).toBe("2026-08-01T00:00:00.000Z");
    expect(signatures[0]?.lastSeenAt).toBe("2026-08-03T00:00:00.000Z");
  });

  /**
   * The action is offered on the signature's latest occurrence. Anchoring it on
   * whichever row happened to arrive first would attach an operator record to a
   * failure that has already been superseded.
   */
  it("anchors the row on the most recent occurrence, whatever the input order", () => {
    const signatures = groupIncidents([
      incident({
        auditEventId: "55555555-5555-4555-8555-555555555555",
        occurredAt: "2026-08-01T00:00:00.000Z",
      }),
      incident({
        auditEventId: "66666666-6666-4666-8666-666666666666",
        occurredAt: "2026-08-05T00:00:00.000Z",
      }),
    ]);
    expect(signatures[0]?.latest.auditEventId).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
  });

  it("separates the same code raised on different aggregates", () => {
    const signatures = groupIncidents([
      incident(),
      incident({ aggregateType: "provider_operation" }),
    ]);
    expect(signatures).toHaveLength(2);
  });

  it("orders signatures by their most recent occurrence", () => {
    const signatures = groupIncidents([
      incident({ safeCode: "OLD", occurredAt: "2026-01-01T00:00:00.000Z" }),
      incident({ safeCode: "NEW", occurredAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(signatures.map((signature) => signature.safeCode)).toEqual([
      "NEW",
      "OLD",
    ]);
  });
});
