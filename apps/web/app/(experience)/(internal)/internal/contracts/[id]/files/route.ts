import { z } from "zod";
import { uploadableContractFileKinds } from "@clockwork/contracts";
import {
  fromApplicationOrigin,
  jsonFailure,
  readUploadForm,
  uploadedPdf,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractRepository,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";

/** Attaches one PDF to a contract. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!fromApplicationOrigin(request))
    return new Response(null, { status: 403 });
  try {
    const session = await contractStaff("contract:write");
    const contractId = z.uuid().parse((await params).id);
    const file = await withDocumentSlot(async () => {
      const form = await readUploadForm(request);
      const kind = z.enum(uploadableContractFileKinds).parse(form.get("kind"));
      const { fileName, bytes } = await uploadedPdf(form);
      return contractRepository().addFile(
        contractId,
        { kind, fileName, bytes },
        contractActor(session),
      );
    });
    return Response.json(
      { ok: true, value: file },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
