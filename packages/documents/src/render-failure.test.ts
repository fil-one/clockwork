import type * as ReactPdf from "@react-pdf/renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommerceDocumentInput } from "./model";

type RenderToBuffer = typeof ReactPdf.renderToBuffer;

const mocks = vi.hoisted(() => ({
  renderToBuffer: vi.fn<RenderToBuffer>(),
  original: { current: undefined as RenderToBuffer | undefined },
}));

/**
 * Only `renderToBuffer` is replaced. The rest of the module is the real one --
 * `documents.tsx` builds its elements out of `Document`, `Page`, `View`,
 * `Text` and `StyleSheet`, so a bare stub would fail for a reason that has
 * nothing to do with what is under test.
 */
vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactPdf>();
  mocks.original.current = actual.renderToBuffer;
  return { ...actual, renderToBuffer: mocks.renderToBuffer };
});

const { demoDocuments } = await import("./__fixtures__/demo-documents");
const { renderAuthorizedCommerceDocument } = await import("./delivery");
const { DocumentRenderError, renderCommerceDocument } =
  await import("./render");

const accountId = "10000000-0000-4000-8000-000000000001";
const firstFixture = demoDocuments[0];
if (!firstFixture) throw new Error("The document fixtures are empty.");
const input: CommerceDocumentInput = firstFixture;

function authorizedContext(requestId: string) {
  return {
    actorUserId: "20000000-0000-4000-8000-000000000002",
    accountId,
    accountIds: [accountId],
    isInternalStaff: false,
    audience: "customer" as const,
    audienceAccountId: accountId,
    kind: input.kind,
    sourceHash: input.verification.recordHash,
    requestId,
  };
}

/**
 * The exact shape of the failure that made every document in the product
 * unreachable: the bundled reconciler read React's client internals off
 * `undefined`, so what surfaced was a `TypeError` naming one letter.
 */
function reconcilerFailure(): TypeError {
  return new TypeError("Cannot read properties of undefined (reading 'S')");
}

function captureErrorLog(): readonly { message: unknown; detail: unknown }[] {
  const entries: { message: unknown; detail: unknown }[] = [];
  vi.spyOn(console, "error").mockImplementation(
    (message: unknown, detail: unknown) => {
      entries.push({ message, detail });
    },
  );
  return entries;
}

describe("renderer failures keep their cause", () => {
  beforeEach(() => {
    mocks.renderToBuffer.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the document and carries the original error", async () => {
    const cause = reconcilerFailure();
    mocks.renderToBuffer.mockRejectedValue(cause);

    const thrown: unknown = await renderCommerceDocument(input).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(DocumentRenderError);
    const failure = thrown as InstanceType<typeof DocumentRenderError>;
    expect(failure.code).toBe("DOCUMENT_RENDER_FAILED");
    expect(failure.kind).toBe(input.kind);
    expect(failure.documentId).toBe(input.documentId);
    expect(failure.message).toContain(
      "Cannot read properties of undefined (reading 'S')",
    );
    expect(failure.cause).toBe(cause);
  });

  /**
   * The boundary above this one answers 503 with a generic title in
   * production, by design. Reading the cause used to require patching that
   * handler; it is written to the server log here instead, against the same
   * request id the response carries.
   */
  it("reports the cause and the request it failed on before rethrowing", async () => {
    mocks.renderToBuffer.mockRejectedValue(reconcilerFailure());
    const logged = captureErrorLog();

    await expect(
      renderAuthorizedCommerceDocument(
        input,
        authorizedContext("render-failure-test"),
      ),
    ).rejects.toBeInstanceOf(DocumentRenderError);

    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe("Commerce document render failed");
    expect(logged[0]?.detail).toMatchObject({
      requestId: "render-failure-test",
      kind: input.kind,
      documentId: input.documentId,
      audience: "customer",
      code: "DOCUMENT_RENDER_FAILED",
      cause: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'S')",
      },
    });
  });

  /**
   * The one test here that renders for real: the mock is handed back the
   * module's own `renderToBuffer`, so the time is a full @react-pdf/renderer
   * pass over the fixture -- about a fifth of a second unloaded, and enough
   * more on a CI runner rendering in parallel to overrun the 5s default. The
   * budget below matches the package's other real-render suites.
   */
  it("logs nothing, and still produces a PDF, when the render succeeds", async () => {
    const original = mocks.original.current;
    if (!original) throw new Error("The renderer module was not loaded.");
    mocks.renderToBuffer.mockImplementation(original);
    const logged = captureErrorLog();

    const rendered = await renderAuthorizedCommerceDocument(
      input,
      authorizedContext("render-success-test"),
    );

    expect(new TextDecoder("latin1").decode(rendered.bytes.slice(0, 5))).toBe(
      "%PDF-",
    );
    expect(logged).toHaveLength(0);
  }, 30_000);
});
