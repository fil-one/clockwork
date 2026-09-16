import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const { GET, dynamic } = await import("./route");

describe("load balancer health probe", () => {
  it("answers 200 with an ok status", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is never served from a cache", () => {
    // A cached 200 would keep a dead task in the target group for as long as
    // the entry lived, which is the one failure a liveness probe must not have.
    expect(GET().headers.get("cache-control")).toBe("no-store");
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads nothing", () => {
    // The claim the route's comment makes, bound to the source: a probe that
    // acquired a database or session import would start failing for reasons
    // that have nothing to do with whether this process can serve a request.
    const source = readFileSync(join(import.meta.dirname, "route.ts"), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(imports).toEqual(["next/server"]);
    expect(source).not.toContain("process.env");
  });
});
