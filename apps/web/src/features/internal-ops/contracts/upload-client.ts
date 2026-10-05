import {
  contractDocumentMaxBytes,
  type ContractFileRecord,
  type UploadableContractFileKind,
} from "@clockwork/contracts";

/** Checks a chosen file before it is sent, with the server's own rules. */
export function localFileProblem(file: File): string | null {
  if (file.size === 0) return "DOCUMENT_EMPTY";
  if (file.size > contractDocumentMaxBytes) return "DOCUMENT_TOO_LARGE";
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name))
    return "DOCUMENT_NOT_PDF";
  return null;
}

type UploadResult<T> = { ok: true; value: T } | { ok: false; code: string };

async function post<T>(url: string, form: FormData): Promise<UploadResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (response.status === 403 && !response.headers.get("content-type"))
      return { ok: false, code: "CONTRACT_FORBIDDEN" };
    const body = (await response.json()) as UploadResult<T>;
    return body;
  } catch {
    return { ok: false, code: "UPLOAD_INTERRUPTED" };
  }
}

export function uploadContractFile(
  contractId: string,
  file: File,
  kind: UploadableContractFileKind,
) {
  const problem = localFileProblem(file);
  if (problem) return Promise.resolve({ ok: false as const, code: problem });
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);
  return post<ContractFileRecord>(
    `/internal/contracts/${contractId}/files`,
    form,
  );
}

export function postCollateral<T>(url: string, form: FormData) {
  return post<T>(url, form);
}
