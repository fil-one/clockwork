import "server-only";
import {
  contractDocumentMaxBytes,
  contractPdfFileName,
} from "@clockwork/contracts";
import { failure } from "./action-result";

const noStore = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

/** Uploads change state with a cookie session, so they must come from this
 * application's own pages. */
export function fromApplicationOrigin(request: Request) {
  const origin = process.env.APP_ORIGIN;
  return Boolean(origin) && request.headers.get("origin") === origin;
}

/**
 * Reads a multipart form of at most one PDF plus a few fields. The body is
 * counted as it streams, so a missing or dishonest Content-Length cannot
 * make the server buffer more than the limit.
 */
export async function readUploadForm(request: Request): Promise<FormData> {
  const limit = contractDocumentMaxBytes + 64 * 1024;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error("DOCUMENT_TOO_LARGE");
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data"))
    throw new Error("UPLOAD_INVALID");
  if (!request.body) throw new Error("UPLOAD_INVALID");
  // Count bytes as the parser pulls them, without buffering a second copy.
  let size = 0;
  let tooLarge = false;
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.length;
        if (size > limit) {
          tooLarge = true;
          controller.error(new Error("DOCUMENT_TOO_LARGE"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    return await new Response(counted, {
      headers: { "content-type": type },
    }).formData();
  } catch (error) {
    if (tooLarge) throw new Error("DOCUMENT_TOO_LARGE");
    if (error instanceof TypeError) throw new Error("UPLOAD_INVALID");
    throw error;
  }
}

/**
 * At most three document reads or writes run at once while PDFs live in the
 * database, so a burst of large uploads cannot exhaust memory or the
 * connection pool. Further requests wait their turn; past twenty waiting,
 * the request is refused and can be retried.
 */
const documentSlotLimit = 3;
const documentQueueLimit = 20;
let activeDocumentSlots = 0;
const waitingForSlot: (() => void)[] = [];

export async function withDocumentSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (activeDocumentSlots < documentSlotLimit) activeDocumentSlots += 1;
  else if (waitingForSlot.length >= documentQueueLimit)
    throw new Error("DOCUMENT_BUSY");
  // A released slot passes straight to the next waiter.
  else await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  try {
    return await operation();
  } finally {
    const next = waitingForSlot.shift();
    if (next) next();
    else activeDocumentSlots -= 1;
  }
}

/** The JSON details sent beside an uploaded file. */
export function itemField(form: FormData): unknown {
  const raw = form.get("item");
  if (typeof raw !== "string") throw new Error("UPLOAD_INVALID");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("UPLOAD_INVALID");
  }
}

export async function uploadedPdf(form: FormData) {
  const file = form.get("file");
  // Checked by shape: the multipart parser's File class need not be the
  // global one.
  if (!file || typeof file === "string") throw new Error("DOCUMENT_EMPTY");
  return {
    fileName: contractPdfFileName(file.name || "document"),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

const statusFor = (code: string) =>
  code === "CONTRACT_FORBIDDEN" || code === "CONTRACT_DEMO_UNAVAILABLE"
    ? 403
    : code === "CONTRACT_MFA_REQUIRED" || code === "SESSION_EXPIRED"
      ? 401
      : code.endsWith("_NOT_FOUND")
        ? 404
        : code === "DOCUMENT_TOO_LARGE"
          ? 413
          : code === "DOCUMENT_NOT_PDF" ||
              code === "DOCUMENT_EMPTY" ||
              code === "INVALID_INPUT" ||
              code === "UPLOAD_INVALID"
            ? 422
            : code === "UNEXPECTED" || code === "DOCUMENT_INTEGRITY"
              ? 500
              : code === "DOCUMENT_BUSY"
                ? 503
                : 409;

/** A refusal or failure as JSON; access errors carry their code. */
export function jsonFailure(error: unknown) {
  const result = failure(error);
  return Response.json(result, {
    status: statusFor(result.code),
    headers: noStore,
  });
}

/** `Content-Disposition` with an ASCII fallback and the exact UTF-8 name. */
export function contentDisposition(
  fileName: string,
  disposition: "attachment" | "inline" = "attachment",
) {
  const name = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;
  const ascii = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  return `${disposition}; filename="${ascii || "document.pdf"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function pdfResponse(
  bytes: Uint8Array,
  fileName: string,
  disposition: "attachment" | "inline",
) {
  // A view over the stored bytes, not a copy.
  const body = new Uint8Array(
    bytes.buffer as ArrayBuffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  return new Response(body, {
    headers: {
      ...noStore,
      // A PDF opened in the browser runs no script and is not embeddable
      // from other sites.
      "content-security-policy": "sandbox",
      "cross-origin-resource-policy": "same-origin",
      "content-type": "application/pdf",
      "content-length": String(bytes.length),
      "content-disposition": contentDisposition(fileName, disposition),
    },
  });
}
