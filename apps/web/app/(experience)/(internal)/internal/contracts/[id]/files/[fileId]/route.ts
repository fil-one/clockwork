import { z } from "zod";
import {
  jsonFailure,
  pdfResponse,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractRepository,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";

/** Streams a stored contract PDF after checking it against its hash.
 * `?view=1` opens it in the browser instead of saving it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    await contractStaff("contract:read");
    const { id, fileId } = await params;
    const { file, bytes } = await contractRepository().readFile(
      z.uuid().parse(id),
      z.uuid().parse(fileId),
    );
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
