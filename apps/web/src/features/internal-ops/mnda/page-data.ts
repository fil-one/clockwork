import "server-only";
import { MndaRegisterQuerySchema, type MndaResult } from "@clockwork/contracts";
import { getRequestCommerceSession } from "@/src/auth/session";
import type { MndaSettingsData, MndaWorkspaceData } from "./actions";
import { demoMndaViewer, demoMndaWorkspaceData } from "./demo-workspace";
import { mndaFailure } from "./results";
import {
  mndaCanManage,
  mndaConfiguration,
  mndaRepository,
  mndaSigners,
  mndaStaff,
  type MndaSession,
} from "./server";

export async function mndaWorkspaceData(
  session: MndaSession,
  rawQuery: unknown,
): Promise<MndaWorkspaceData> {
  const query = MndaRegisterQuerySchema.parse(rawQuery);
  const repository = mndaRepository();
  const [register, signers, settings] = await Promise.all([
    repository.list(query, session.userId),
    mndaSigners(),
    repository.settings(),
  ]);
  return {
    register,
    signers: signers.filter((s) => s.active),
    noticeEmail: settings.noticeEmail,
    ...mndaConfiguration(),
    canManage: mndaCanManage(session),
    viewerId: session.userId,
  };
}

/** Takes the guarded session so a caller cannot reach the countersigners
 * without first checking `signatory:manage`. */
export async function mndaSettingsData(
  session: MndaSession,
): Promise<MndaSettingsData> {
  if (!mndaCanManage(session)) throw new Error("MNDA_FORBIDDEN");
  return {
    signers: await mndaSigners(),
    settings: await mndaRepository().settings(),
  };
}

async function pageResult<T>(load: () => Promise<T>): Promise<MndaResult<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return mndaFailure(error);
  }
}

/** The register page's first load. It shares the layout's request-cached
 * session; the same read called as an action verifies the session afresh. */
export function loadMndaPage(rawQuery: unknown) {
  return pageResult(async () => {
    const viewer = await demoMndaViewer(getRequestCommerceSession);
    if (viewer) return demoMndaWorkspaceData(viewer, rawQuery);
    return mndaWorkspaceData(
      await mndaStaff("mnda:send", getRequestCommerceSession),
      rawQuery,
    );
  });
}

export function loadMndaSettingsPage() {
  return pageResult(async () => {
    return mndaSettingsData(
      await mndaStaff("signatory:manage", getRequestCommerceSession),
    );
  });
}
