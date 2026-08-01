import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearEvidenceUploadState,
  EvidenceUploadControl,
} from "./evidence-upload-control";
import type { EvidenceUploadRecord } from "./model";

const csrf = "12345678901234567890123456789012";
const targetId = "80000000-0000-4000-8000-000000000001";

function upload(status: EvidenceUploadRecord["status"]): EvidenceUploadRecord {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    uploadId: "upl_opaque",
    providerUploadId: "provider-upload",
    ownerUserId: "20000000-0000-4000-8000-000000000002",
    accountId: "10000000-0000-4000-8000-000000000001",
    journey: "customer_paper",
    targetId,
    kind: "agreement",
    contentHash: "a".repeat(64),
    mimeType: "application/pdf",
    byteLength: "14",
    retainUntil: "2033-07-31T12:00:00.000Z",
    expiresAt: "2026-07-31T12:15:00.000Z",
    legalHold: false,
    status,
    scanReference:
      status === "promoted" || status === "quarantined" ? "scan-1" : null,
    documentId:
      status === "promoted" ? "90000000-0000-4000-8000-000000000001" : null,
    immutableStorageKey: status === "promoted" ? "immutable/key" : null,
    storageVersionId: status === "promoted" ? "version-1" : null,
    version: 3,
  };
}

const resumeKey = `clockwork:evidence:customer_paper:${targetId}:agreement`;

function oversizedFile(): File {
  const file = new File(["%PDF-1.4\n%%EOF"], "oversized.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });
  return file;
}

beforeEach(() => {
  document.cookie = `clockwork-csrf=${csrf}; path=/`;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

describe("record-bound evidence upload", () => {
  it("uploads without credentials to quarantine then reads promoted server state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          upload: upload("uploaded"),
          method: "PUT",
          uploadUrl: "https://upload.example/object",
          headers: {
            "content-type": "application/pdf",
            "x-amz-checksum-sha256": "checksum",
          },
          expiresAt: "2026-07-31T12:15:00.000Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ upload: upload("promoted") }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );

    await user.upload(
      screen.getByLabelText("Evidence file"),
      new File(["%PDF-1.4\n%%EOF"], "agreement.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Download verified evidence" }),
    ).toBeVisible();
    expect(screen.getByText(/Status:/).parentElement).toHaveTextContent(
      "promoted",
    );
    const providerInit = fetchMock.mock.calls[1]?.[1];
    expect(providerInit?.credentials).toBe("omit");
    expect(new Headers(providerInit?.headers).has("cookie")).toBe(false);
    expect(window.sessionStorage.getItem(resumeKey)).toBe("upl_opaque");
    expect(window.localStorage.getItem(resumeKey)).toBeNull();
  });

  it("reads durable promoted status after reload", async () => {
    window.sessionStorage.setItem(resumeKey, "upl_opaque");
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(upload("promoted"))),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Download verified evidence" }),
    ).toBeVisible();
    const fetched = fetchMock.mock.calls[0]?.[0];
    const fetchedUrl =
      typeof fetched === "string"
        ? fetched
        : fetched instanceof URL
          ? fetched.toString()
          : (fetched?.url ?? "");
    expect(fetchedUrl).toContain("/evidence/uploads/upl_opaque");
  });

  it("keeps malware evidence quarantined and exposes no download", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          upload: upload("uploaded"),
          method: "PUT",
          uploadUrl: "https://upload.example/object",
          headers: { "content-type": "application/pdf" },
          expiresAt: "2026-07-31T12:15:00.000Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ upload: upload("quarantined") }, { status: 422 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );
    await user.upload(
      screen.getByLabelText("Evidence file"),
      new File(["%PDF-1.4\n%%EOF"], "unsafe.pdf", { type: "application/pdf" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /quarantined|could not/i,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Download verified evidence" }),
    ).not.toBeInTheDocument();
  });

  it("rejects a file over the advertised maximum before hashing it", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const digest = vi.spyOn(crypto.subtle, "digest");
    const user = userEvent.setup();
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );

    const input = screen.getByLabelText("Evidence file");
    await user.upload(input, oversizedFile());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("larger than the 50 MB maximum");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(digest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(resumeKey)).toBeNull();
  });

  it("states the same maximum in the guidance and the rejection", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    const user = userEvent.setup();
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );
    const hint = screen.getByText(/maximum/);
    await user.upload(screen.getByLabelText("Evidence file"), oversizedFile());
    const limit = /(\d+ MB)/.exec(hint.textContent ?? "")?.[1];
    expect(limit).toBeDefined();
    expect(await screen.findByRole("alert")).toHaveTextContent(limit ?? "");
  });

  it("keeps no durable record of an abandoned upload", async () => {
    window.localStorage.setItem(resumeKey, "upl_previous_user");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EvidenceUploadControl
        journey="customer_paper"
        targetId={targetId}
        kind="agreement"
      />,
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(resumeKey)).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears every resume key when a session ends", () => {
    window.sessionStorage.setItem(resumeKey, "upl_opaque");
    window.sessionStorage.setItem("unrelated", "keep");
    window.localStorage.setItem(
      `clockwork:evidence:customer_paper:${targetId}:order`,
      "upl_other",
    );
    clearEvidenceUploadState();
    expect(window.sessionStorage.getItem(resumeKey)).toBeNull();
    expect(
      window.localStorage.getItem(
        `clockwork:evidence:customer_paper:${targetId}:order`,
      ),
    ).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
  });
});
