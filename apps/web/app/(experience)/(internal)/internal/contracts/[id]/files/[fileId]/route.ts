import { z } from "zod";
import {
  jsonFailure,
  pdfResponse,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractRepository,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";

/** Streams a stored contract PDF after checking it against its hash, and
 * audits who opened it. `?view=1` opens it in the browser instead of saving
 * it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const session = await contractStaff("contract:read");
    const { id, fileId } = await params;
    const repository = contractRepository();
    const { file, bytes } = await withDocumentSlot(() =>
      repository.readFile(z.uuid().parse(id), z.uuid().parse(fileId)),
    );
    await repository.recordAccess(contractActor(session), {
      kind: "file",
      contractId: id,
      fileId: file.id,
      fileKind: file.kind,
    });
    return pdfResponse(
      bytes,
      file.fileName,
      new URL(request.url).searchParams.get("view") === "1"
        ? "inline"
        : "attachment",
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
