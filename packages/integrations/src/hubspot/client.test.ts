import { describe, expect, it } from "vitest";

import { HttpHubSpotReader, HubSpotError, hubspotNoteText } from "./client";
import { FakeHubSpotReader, fakeHubSpotPdf } from "./fake";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: string | undefined;
}

function stub(routes: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetcher = (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: input.toString(),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined,
      redirect: init?.redirect,
    };
    calls.push(call);
    return Promise.resolve(routes(call));
  };
  return { fetch: fetcher as typeof fetch, calls };
}

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const reader = (fetcher: typeof fetch) =>
  new HttpHubSpotReader({
    accessToken: "pat-na1-test",
    fetch: fetcher,
    sleep: () => Promise.resolve(),
  });

describe("HttpHubSpotReader", () => {
  it("refuses to construct without a usable token", () => {
    expect(() => new HttpHubSpotReader({ accessToken: " " })).toThrow(
      HubSpotError,
    );
    expect(() => new HttpHubSpotReader({ accessToken: "a\nb" })).toThrow(
      HubSpotError,
    );
  });

  it("reads the portal with the bearer token and no redirects", async () => {
    const { fetch, calls } = stub(() =>
      json({ portalId: 4410, uiDomain: "app-eu1.hubspot.com" }),
    );
    await expect(reader(fetch).portal()).resolves.toEqual({
      portalId: "4410",
      uiDomain: "app-eu1.hubspot.com",
      timeZone: null,
      companyCurrency: null,
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.hubapi.com/account-info/v3/details",
      method: "GET",
      redirect: "error",
      headers: { authorization: "Bearer pat-na1-test" },
    });
  });

  it("waits once for a short Retry-After, then reports throttling", async () => {
    let attempts = 0;
    const { fetch } = stub(() => {
      attempts += 1;
      return json({}, 429, { "retry-after": "1" });
    });
    await expect(reader(fetch).pipelines()).rejects.toMatchObject({
      code: "HUBSPOT_RATE_LIMITED",
    });
    expect(attempts).toBe(2);
  });

  it("maps missing records and refused scopes to their own codes", async () => {
    await expect(
      reader(stub(() => json({}, 404)).fetch).associations(
        "company",
        "9",
        "contact",
      ),
    ).rejects.toMatchObject({ code: "HUBSPOT_RECORD_NOT_FOUND" });
    await expect(
      reader(stub(() => json({}, 403)).fetch).owners(),
    ).rejects.toMatchObject({ code: "HUBSPOT_SCOPE_DENIED" });
  });

  it("resolves association labels to names and drops type IDs", async () => {
    const { fetch, calls } = stub(() =>
      json({
        results: [
          {
            toObjectId: 9001,
            associationTypes: [
              { category: "USER_DEFINED", typeId: 7, label: "Reseller" },
              { category: "HUBSPOT_DEFINED", typeId: 341, label: null },
            ],
          },
        ],
      }),
    );
    await expect(
      reader(fetch).associations("deal", "77", "company"),
    ).resolves.toEqual([{ id: "9001", labels: ["Reseller"] }]);
    expect(calls[0]?.url).toBe(
      "https://api.hubapi.com/crm/v4/objects/deals/77/associations/companies?limit=100",
    );
  });

  it("refuses an ID that is not a HubSpot ID before any request", async () => {
    const { fetch, calls } = stub(() => json({}));
    await expect(
      reader(fetch).associations("deal", "../owners", "company"),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reads only the properties asked for and keeps empty as null", async () => {
    const { fetch, calls } = stub(() =>
      json({
        results: [
          {
            id: "9001",
            properties: {
              name: "Northstar",
              domain: "",
              industry: "IT",
              hs_lastmodifieddate: "2026-10-20T00:00:00Z",
            },
          },
        ],
      }),
    );
    const [company] = await reader(fetch).companies(
      ["9001", "bad"],
      ["name", "domain", "industry"],
    );
    expect(company).toMatchObject({
      id: "9001",
      name: "Northstar",
      domain: null,
      properties: { industry: "IT" },
    });
    expect(calls[0]?.body).toEqual({
      properties: ["name", "domain", "industry"],
      inputs: [{ id: "9001" }],
    });
  });

  it("marks closed stages and hides archived pipelines", async () => {
    const { fetch } = stub(() =>
      json({
        results: [
          {
            id: "p",
            label: "Sales",
            displayOrder: 0,
            stages: [
              {
                id: "b",
                label: "Won",
                displayOrder: 1,
                metadata: { isClosed: "true" },
              },
              {
                id: "a",
                label: "New",
                displayOrder: 0,
                metadata: { isClosed: "false" },
              },
            ],
          },
          {
            id: "old",
            label: "Old",
            displayOrder: 1,
            archived: true,
            stages: [],
          },
        ],
      }),
    );
    const pipelines = await reader(fetch).pipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages.map((s) => [s.id, s.closed])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("downloads only PDFs from HubSpot hosts and within the size limit", async () => {
    const pdf = fakeHubSpotPdf("Order form");
    const signed = (url: string) =>
      stub((call) =>
        call.url.includes("/signed-url")
          ? json({ url })
          : new Response(new Uint8Array(pdf), { status: 200 }),
      ).fetch;
    await expect(
      reader(
        signed("https://f.hubspotusercontent-na1.net/hubfs/1/a.pdf?sig=1"),
      ).download("8001", 1_000_000),
    ).resolves.toHaveLength(pdf.byteLength);
    await expect(
      reader(signed("https://attacker.example/a.pdf")).download(
        "8001",
        1_000_000,
      ),
    ).rejects.toMatchObject({ code: "HUBSPOT_DOCUMENT_UNAVAILABLE" });
    await expect(
      reader(
        signed("https://f.hubspotusercontent-na1.net/hubfs/1/a.pdf"),
      ).download("8001", 10),
    ).rejects.toMatchObject({ code: "HUBSPOT_DOCUMENT_INVALID" });
    const notPdf = stub((call) =>
      call.url.includes("/signed-url")
        ? json({ url: "https://f.hubspotusercontent-na1.net/a" })
        : new Response("<html>", { status: 200 }),
    ).fetch;
    await expect(reader(notPdf).download("8001", 1000)).rejects.toMatchObject({
      code: "HUBSPOT_DOCUMENT_INVALID",
    });
  });

  it("never sends the access token to the file host", async () => {
    const { fetch, calls } = stub((call) =>
      call.url.includes("/signed-url")
        ? json({ url: "https://f.hubspotusercontent-na1.net/a.pdf" })
        : new Response(new Uint8Array(fakeHubSpotPdf("x")), { status: 200 }),
    );
    await reader(fetch).download("8001", 1_000_000);
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });

  it("describes files it cannot retain instead of hiding them", async () => {
    const { fetch } = stub(() =>
      json({ id: "8002", name: "logo", extension: "png", size: 10 }),
    );
    await expect(reader(fetch).file("8002", "6002")).resolves.toMatchObject({
      name: "logo.png",
      availability: "unsupported_type",
      noteId: "6002",
    });
    const large = stub(() =>
      json({ id: "8003", name: "big", extension: "pdf", size: 30_000_000 }),
    ).fetch;
    await expect(reader(large).file("8003", "6001")).resolves.toMatchObject({
      availability: "too_large",
    });
    await expect(
      reader(stub(() => json({}, 404)).fetch).file("8004", "6001"),
    ).resolves.toBeNull();
  });
});

describe("hubspotNoteText", () => {
  it("keeps plain text and line breaks and drops markup", () => {
    expect(
      hubspotNoteText(
        '<p>Kickoff &amp; <b>pricing</b></p><script>alert(1)</script><p>Next:<br>send <a href="javascript:x">form</a></p>',
      ),
    ).toBe("Kickoff & pricing\nNext:\nsend form");
    expect(hubspotNoteText(null)).toBe("");
  });
});

describe("FakeHubSpotReader", () => {
  it("returns only requested extra properties", async () => {
    const fake = new FakeHubSpotReader();
    const [company] = await fake.companies(["9001"], ["name", "industry"]);
    expect(company?.properties).toEqual({
      industry: "Information Technology and Services",
    });
    expect(company?.properties).not.toHaveProperty("tax_id");
  });

  it("fails a download on request and then recovers", async () => {
    const fake = new FakeHubSpotReader();
    fake.failDownload("8001");
    await expect(fake.download("8001", 1_000_000)).rejects.toBeInstanceOf(
      HubSpotError,
    );
    await expect(fake.download("8001", 1_000_000)).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it("pages pipeline deals", async () => {
    const fake = new FakeHubSpotReader();
    const first = await fake.pipelineDeals({
      pipelineId: "default",
      stageIds: [],
      properties: ["dealname"],
      after: null,
      limit: 4,
    });
    expect(first.total).toBe(7);
    expect(first.deals).toHaveLength(4);
    const second = await fake.pipelineDeals({
      pipelineId: "default",
      stageIds: [],
      properties: ["dealname"],
      after: first.next,
      limit: 4,
    });
    expect(second.deals).toHaveLength(3);
    expect(second.next).toBeNull();
  });
});
