import type { SessionClaims, SessionResolver } from "@clockwork/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public resolve() {
      return Promise.resolve(null);
    }
  },
}));

import { handleExperienceRequest } from "./controller";
import { ExperienceProblem } from "./model";
import type { DatabaseExperienceRepository } from "./repository";

const accountA = "10000000-0000-4000-8000-000000000001";
const artifactId = "90000000-0000-4000-8000-000000000001";

const session: SessionClaims = {
  userId: "20000000-0000-4000-8000-000000000002",
  organizationId: "30000000-0000-4000-8000-000000000001",
  accountIds: [accountA],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function resolver(): SessionResolver {
  return { resolve: vi.fn(() => Promise.resolve(session)) };
}

/**
 * The failure that produced this instrument, reproduced exactly.
 *
 * `@react-pdf/renderer`'s bundled reconciler read React's client internals off
 * `undefined`. Every one of the catalog's artifacts answered 503
 * `EXPERIENCE_UNAVAILABLE` and this message -- which names the defect outright
 * -- reached nobody, because the production branch of `problem()` replaces it
 * with a constant and nothing else in the process wrote it down.
 */
function incidentError(): TypeError {
  return new TypeError("Cannot read properties of undefined (reading 'S')");
}

/** Captures the two-argument `console.error` the render boundary established. */
function captureErrorLog(): readonly { message: unknown; detail: unknown }[] {
  const entries: { message: unknown; detail: unknown }[] = [];
  vi.spyOn(console, "error").mockImplementation(
    (message: unknown, detail: unknown) => {
      entries.push({ message, detail });
    },
  );
  return entries;
}

function readRequest(path: string, requestId = "request-12345678") {
  return new Request(`https://app.example${path}`, {
    method: "GET",
    headers: {
      cookie: "workos-session=secret-session-cookie",
      "x-request-id": requestId,
    },
  });
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    findArtifact: vi.fn(),
    ...overrides,
  } as unknown as DatabaseExperienceRepository;
}

/**
 * The production branch is the one under test. `problem()` reads
 * `process.env.NODE_ENV` at call time, so setting it here exercises the exact
 * code path a deployed build takes -- the branch that swaps the cause for a
 * constant, which is what made the incident unreadable.
 */
beforeEach(() => {
  process.env.CLOCKWORK_CANONICAL_ORIGIN = "https://app.example";
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the experience request-failure path keeps the cause", () => {
  it("withholds the cause from the tenant and writes it to the log under the same request id", async () => {
    const logged = captureErrorLog();
    const response = await handleExperienceRequest(
      readRequest(`/api/experience/artifacts/receipt/${artifactId}`),
      ["artifacts", "receipt", artifactId],
      {
        repository: repository({
          findArtifact: vi.fn(() => Promise.reject(incidentError())),
        }),
        sessionResolver: resolver(),
      },
    );

    // The tenant response is unchanged: still a bare 503, still the constant.
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("EXPERIENCE_UNAVAILABLE");
    expect(body.title).toBe("The experience service is unavailable");
    expect(body.title).not.toContain("reading 'S'");
    expect(body.requestId).toBe("request-12345678");

    // The server side now has the record, joined on the id the client holds.
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe("Experience request failed");
    expect(logged[0]?.detail).toMatchObject({
      requestId: body.requestId,
      method: "GET",
      route: `artifacts/receipt/${artifactId}`,
      code: "EXPERIENCE_UNAVAILABLE",
      status: 503,
      error: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'S')",
      },
    });
  });

  it("joins on the generated request id when the client supplied none", async () => {
    const logged = captureErrorLog();
    const response = await handleExperienceRequest(
      new Request(
        `https://app.example/api/experience/artifacts/receipt/${artifactId}`,
        {
          method: "GET",
          headers: { cookie: "workos-session=secret-session-cookie" },
        },
      ),
      ["artifacts", "receipt", artifactId],
      {
        repository: repository({
          findArtifact: vi.fn(() => Promise.reject(incidentError())),
        }),
        sessionResolver: resolver(),
      },
    );

    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId).not.toBe("");
    expect(logged).toHaveLength(1);
    // The join is the whole point: an operator holding the id from a failed
    // response must be able to find the cause with it, including when the id
    // was minted server-side.
    expect(logged[0]?.detail).toMatchObject({ requestId: body.requestId });
  });

  it("reports the attached cause of an ExperienceProblem, which the body never carries", async () => {
    const logged = captureErrorLog();
    const problem = new ExperienceProblem(
      502,
      "PROJECTION_SOURCE_UNAVAILABLE",
      "The projection source is unavailable",
    );
    problem.cause = incidentError();
    const response = await handleExperienceRequest(
      readRequest(`/api/experience/artifacts/receipt/${artifactId}`),
      ["artifacts", "receipt", artifactId],
      {
        repository: repository({
          findArtifact: vi.fn(() => Promise.reject(problem)),
        }),
        sessionResolver: resolver(),
      },
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("reading 'S'");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.detail).toMatchObject({
      requestId: body.requestId,
      code: "PROJECTION_SOURCE_UNAVAILABLE",
      status: 502,
      cause: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'S')",
      },
    });
  });

  it("reports a malformed path, which fails before the cleaned segments exist", async () => {
    const logged = captureErrorLog();
    // `cleanSegments` calls `decodeURIComponent`, which throws `URIError` on a
    // lone escape. This is a real uninjected non-ExperienceProblem failure and
    // it happens before session resolution, so it is the case a report keyed on
    // the cleaned segments would have had nothing to report.
    const response = await handleExperienceRequest(
      readRequest("/api/experience/projections/customer/quotes/%"),
      ["projections", "customer", "quotes", "%"],
      { repository: repository(), sessionResolver: resolver() },
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(logged).toHaveLength(1);
    expect(logged[0]?.detail).toMatchObject({
      requestId: body.requestId,
      route: "projections/customer/quotes/%",
      error: { name: "URIError" },
    });
  });

  it("bounds a hostile path rather than writing it whole", async () => {
    const logged = captureErrorLog();
    await handleExperienceRequest(
      readRequest("/api/experience/projections/customer/quotes/%"),
      [
        "projections",
        ...Array.from({ length: 40 }, () => "x".repeat(200)),
        "%",
      ],
      { repository: repository(), sessionResolver: resolver() },
    );
    const route = (logged[0]?.detail as { route: string }).route;
    expect(route.length).toBeLessThanOrEqual(512);
  });

  it("writes nothing for a problem the response body already explains", async () => {
    const logged = captureErrorLog();
    const response = await handleExperienceRequest(
      readRequest("/api/experience/nope"),
      ["nope"],
      { repository: repository(), sessionResolver: resolver() },
    );

    expect(response.status).toBe(404);
    // A catalogued `ExperienceProblem` puts its own message, code and status in
    // the body in every environment. Logging it again would be noise that
    // buries the failures this instrument exists for.
    expect(logged).toHaveLength(0);
  });
});
