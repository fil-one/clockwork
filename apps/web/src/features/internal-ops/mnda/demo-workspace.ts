import "server-only";
import {
  contextHasPermission,
  MndaRegisterQuerySchema,
  type MndaRecord,
} from "@clockwork/contracts";
import { renderMnda } from "@clockwork/documents";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import type { MndaWorkspaceData } from "./actions";
import {
  demoMndaNoticeEmail,
  demoMndaRegister,
  demoMndaSigners,
  type DemoMndaViewer,
} from "./demo-register";

/**
 * The reader of the demo MNDA register, or null outside the demo. Demo
 * personas read fictional records only; `mndaStaff` still refuses every
 * action that would prepare, send or change one. Page renders pass the
 * request-cached session reader; actions and routes read it afresh.
 */
export async function demoMndaViewer(
  readSession: () => Promise<CommerceSession> = getCommerceSession,
): Promise<DemoMndaViewer | null> {
  if (!explicitDemoIdentityEnabled()) return null;
  const session = await readSession();
  if (!session.isInternalStaff || !contextHasPermission(session, "mnda:send"))
    throw new Error("MNDA_FORBIDDEN");
  return {
    id: session.userId,
    name: session.profile.name,
    email: session.profile.email,
  };
}

/** The workspace a demo persona opens: the fictional register, read-only. */
export function demoMndaWorkspaceData(
  viewer: DemoMndaViewer,
  rawQuery: unknown,
): MndaWorkspaceData {
  return {
    register: demoMndaRegister(
      MndaRegisterQuerySchema.parse(rawQuery),
      viewer,
      demoNow(),
    ),
    signers: [...demoMndaSigners],
    noticeEmail: demoMndaNoticeEmail,
    ready: false,
    testMode: false,
    canManage: false,
    viewerId: viewer.id,
    demo: true,
  };
}

const demoPdfs = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/**
 * The unsigned agreement for a demo request, rendered once per request and
 * effective date. Fixture details do not change within a day, so opening the
 * same PDF again does not render the template again.
 */
export function demoMndaPdf(
  record: MndaRecord,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = `${record.id}:${record.input.effectiveDate}`;
  const cached = demoPdfs.get(key);
  if (cached) return cached;
  if (demoPdfs.size >= 100) demoPdfs.clear();
  const pdf = renderMnda(record.input, record.countersigner, {
    noticeEmail: record.noticeEmail ?? record.countersigner.email,
  }).then((rendered) => new Uint8Array(rendered.bytes));
  // A failed render is not kept, so the next request tries again.
  pdf.catch(() => demoPdfs.delete(key));
  demoPdfs.set(key, pdf);
  return pdf;
}
