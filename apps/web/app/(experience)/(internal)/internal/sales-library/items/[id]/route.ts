import { z } from "zod";
import {
  fromApplicationOrigin,
  jsonFailure,
  pdfResponse,
  itemField,
  readUploadForm,
  uploadedPdf,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractStaff,
  salesLibraryRepository,
} from "@/src/features/internal-ops/contracts/server";

/** Downloads an item's PDF, or opens it with `?view=1`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await contractStaff("sales:read");
    const id = z.uuid().parse((await params).id);
    const { record, bytes } = await withDocumentSlot(() =>
      salesLibraryRepository().readFile(id),
    );
    return pdfResponse(
      bytes,
      record.file?.fileName ?? `${record.title}.pdf`,
      new URL(request.url).searchParams.get("view") === "1"
        ? "inline"
        : "attachment",
    );
  } catch (error) {
    return jsonFailure(error);
  }
}

/** Saves details and replaces the PDF of a file item. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!fromApplicationOrigin(request))
    return new Response(null, { status: 403 });
  try {
    const session = await contractStaff("collateral:manage");
    const id = z.uuid().parse((await params).id);
    const record = await withDocumentSlot(async () => {
      const form = await readUploadForm(request);
      const item = itemField(form);
      const expectedVersion = z.coerce
        .number()
        .int()
        .min(1)
        .parse(form.get("expectedVersion"));
      return salesLibraryRepository().update(
        id,
        expectedVersion,
        item,
        await uploadedPdf(form),
        contractActor(session),
      );
    });
    return Response.json(
      { ok: true, value: record },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
