import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public resolve() {
      return Promise.resolve(null);
    }
  },
}));

import { GET } from "./route";

const segments = ["projections", "customer", "quotes"];

function request(requestId: string) {
  return new Request(
    "http://localhost:3000/api/experience/projections/customer/quotes",
    { headers: { "x-request-id": requestId } },
  );
}

describe("experience API boundary", () => {
  it("answers with the controller problem response for every correlation header", async () => {
    // The boundary span opens before the controller, so a header the telemetry
    // layer refuses must still reach the controller instead of escaping as 500.
    for (const header of [
      "proof-request-id-0001",
      "proof request id 0001",
      "proof@request.id.0001",
    ]) {
      const response = await GET(request(header), {
        params: Promise.resolve({ segments }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      await expect(response.json()).resolves.toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
        requestId: header,
      });
    }
  });
});
