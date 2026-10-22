import "server-only";
import { z } from "zod";
import {
  AccountDocumentInputSchema,
  AccountDocumentTargetSchema,
} from "@clockwork/contracts";
import { contractActor } from "../contracts/server";
import {
  fromApplicationOrigin,
  itemField,
  jsonFailure,
  pdfResponse,
  readUploadForm,
  uploadedPdf,
  withDocumentSlot,
} from "../contracts/http";
import { accountDocumentRepository, accountDocumentStaff } from "./server";

type Params = { type: string; id: string; fileId?: string };
export async function uploadAccountDocument(
  request: Request,
  context: { params: Promise<Params> },
) {
  if (!fromApplicationOrigin(request))
    return new Response(null, { status: 403 });
  try {
    const { type, id } = await context.params;
    const target = AccountDocumentTargetSchema.parse({ type, id });
    const session = await accountDocumentStaff(target, true);
    const file = await withDocumentSlot(async () => {
      const form = await readUploadForm(request);
      const input = AccountDocumentInputSchema.parse(itemField(form));
      return accountDocumentRepository().add(
        target,
        input,
        await uploadedPdf(form),
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
export async function downloadAccountDocument(
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
