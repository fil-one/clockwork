import "server-only";
import { z } from "zod";
import { AccountDocumentTargetSchema } from "@clockwork/contracts";
import { contractActor } from "@/src/features/internal-ops/contracts/server";
import {
  jsonFailure,
  pdfResponse,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  accountDocumentRepository,
  accountDocumentStaff,
} from "@/src/features/internal-ops/account-documents/server";

type Params = { type: string; id: string; fileId: string };
export async function GET(
  request: Request,
  context: { params: Promise<Params> },
) {
  try {
    const { type, id, fileId } = await context.params;
    const target = AccountDocumentTargetSchema.parse({ type, id });
    const session = await accountDocumentStaff(target);
    return await withDocumentSlot(async () => {
      const { file, bytes } = await accountDocumentRepository().read(
        target,
        z.uuid().parse(fileId),
        contractActor(session),
      );
      return pdfResponse(
        bytes,
        file.fileName,
        new URL(request.url).searchParams.get("view") === "1"
          ? "inline"
          : "attachment",
      );
    });
  } catch (error) {
    return jsonFailure(error);
  }
}
