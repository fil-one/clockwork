import "server-only";
import { contractDocumentMaxBytes } from "@clockwork/contracts";
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
  const reader = request.body?.getReader();
  if (!reader) throw new Error("UPLOAD_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("DOCUMENT_TOO_LARGE");
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": type },
  }).formData();
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
    fileName: file.name || "document.pdf",
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

const statusFor = (code: string) =>
  code === "CONTRACT_FORBIDDEN" || code === "CONTRACT_DEMO_UNAVAILABLE"
    ? 403
    : code === "CONTRACT_MFA_REQUIRED"
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
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...noStore,
      "content-type": "application/pdf",
      "content-length": String(bytes.length),
      "content-disposition": contentDisposition(fileName, disposition),
    },
  });
}
