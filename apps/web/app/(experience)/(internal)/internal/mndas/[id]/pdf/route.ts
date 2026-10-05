import { z } from "zod";
import {
  mndaRepository,
  mndaStaff,
} from "@/src/features/internal-ops/mnda/server";
import {
  contentDisposition,
  mndaPdfFilename,
} from "@/src/features/internal-ops/mnda/register";

export const dynamic = "force-dynamic";

/** Original or executed PDF, named for a deal folder. Opens in the browser
 * unless `download=1`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await mndaStaff();
  } catch {
    return new Response(null, { status: 403 });
  }
  const id = z.uuid().safeParse((await params).id);
  const search = new URL(request.url).searchParams;
  const kind = z
    .enum(["original", "executed"])
    .safeParse(search.get("kind") ?? "original");
  if (!id.success || !kind.success) return new Response(null, { status: 404 });
  try {
    const repository = mndaRepository();
    const record = await repository.get(id.data);
    const bytes = await repository.readArtifact(id.data, kind.data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": contentDisposition(
          mndaPdfFilename(record, kind.data),
          search.get("download") === "1" ? "attachment" : "inline",
        ),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return new Response(null, {
      status: message.endsWith("NOT_FOUND") ? 404 : 500,
    });
  }
}
