import "server-only";
import {
  AccountDocumentInputSchema,
  AccountDocumentTargetSchema,
} from "@clockwork/contracts";
import { contractActor } from "@/src/features/internal-ops/contracts/server";
import {
  fromApplicationOrigin,
  itemField,
  jsonFailure,
  readUploadForm,
  uploadedPdf,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  accountDocumentRepository,
  accountDocumentStaff,
} from "@/src/features/internal-ops/account-documents/server";

type Params = { type: string; id: string };
export async function POST(
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
