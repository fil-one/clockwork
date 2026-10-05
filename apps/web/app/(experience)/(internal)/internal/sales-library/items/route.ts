import {
  fromApplicationOrigin,
  jsonFailure,
  itemField,
  readUploadForm,
  uploadedPdf,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractStaff,
  salesLibraryRepository,
} from "@/src/features/internal-ops/contracts/server";

/** Adds a sales library item backed by a PDF. */
export async function POST(request: Request) {
  if (!fromApplicationOrigin(request))
    return new Response(null, { status: 403 });
  try {
    const session = await contractStaff("collateral:manage");
    const form = await readUploadForm(request);
    const item = itemField(form);
    const file = await uploadedPdf(form);
    const record = await salesLibraryRepository().create(
      item,
      file,
      contractActor(session),
    );
    return Response.json(
      { ok: true, value: record },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
