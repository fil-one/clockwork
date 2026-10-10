import { z } from "zod";
import { renderMnda } from "@clockwork/documents";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import { demoMndaRecords } from "@/src/features/internal-ops/mnda/demo-register";
import { demoMndaViewer } from "@/src/features/internal-ops/mnda/demo-workspace";
import {
  mndaActor,
  mndaRepository,
  mndaStaff,
  type MndaSession,
} from "@/src/features/internal-ops/mnda/server";
import {
  contentDisposition,
  mndaPdfFilename,
} from "@/src/features/internal-ops/mnda/register";

export const dynamic = "force-dynamic";

/** Original or executed PDF, named for a deal folder. Opens in the browser
 * unless `download=1`. Every access is audited. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session: MndaSession | null = null;
  let demo: Awaited<ReturnType<typeof demoMndaViewer>>;
  try {
    demo = await demoMndaViewer();
    if (!demo) session = await mndaStaff();
  } catch {
    return new Response(null, { status: 403 });
  }
  const id = z.uuid().safeParse((await params).id);
  const search = new URL(request.url).searchParams;
  const kind = z
    .enum(["original", "executed"])
    .safeParse(search.get("kind") ?? "original");
  if (!id.success || !kind.success) return new Response(null, { status: 404 });
  const disposition = search.get("download") === "1" ? "attachment" : "inline";
  if (demo) {
    // The demo stores no documents and nothing was signed: every request,
    // completed or not, opens the unsigned agreement rendered from its
    // fictional details, named as a draft.
    const record = demoMndaRecords(demo, demoNow()).find(
      (candidate) => candidate.id === id.data,
    );
    if (!record) return new Response(null, { status: 404 });
    const pdf = await renderMnda(record.input, record.countersigner, {
      noticeEmail: record.noticeEmail ?? record.countersigner.email,
    });
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": contentDisposition(
          mndaPdfFilename(record, "original"),
          disposition,
        ),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!session) return new Response(null, { status: 403 });
  try {
    const repository = mndaRepository();
    const record = await repository.get(id.data);
    const bytes = await repository.readArtifact(id.data, kind.data);
    await repository.recordAccess(mndaActor(session), {
      kind: "pdf",
      requestId: id.data,
      artifact: kind.data,
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": contentDisposition(
          mndaPdfFilename(record, kind.data),
          disposition,
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
