import type { Metadata } from "next";
import { withAuth } from "@workos-inc/authkit-nextjs";

import type { InvitePreview } from "@clockwork/db";
import { BrandLogo, StateBanner } from "@clockwork/ui";

import { workosAuthenticationConfigured } from "@/src/auth/session";
import { AcceptInvite } from "@/src/features/invite/accept-invite";
import { inviteMessage, inviteRoleLabels } from "@/src/features/invite/model";
import {
  inviteRepository,
  inviteTokenShape,
} from "@/src/features/invite/server";
import { brandAsset } from "@/src/features/shell/brand-assets";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("platform.invite.title") };
}

async function readInvite(
  token: string,
): Promise<{ invite: InvitePreview } | { code: string }> {
  if (!inviteTokenShape.test(token)) return { code: "INVITE_NOT_FOUND" };
  try {
    const invite = await inviteRepository().preview(token);
    // A link from before a secret rotation opens nothing, and says nothing
    // about the organization it was for.
    return invite.state === "void" ? { code: "INVITE_NOT_FOUND" } : { invite };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      code: /^INVITE_[A-Z_]+$/u.test(message) ? message : "INVITE_FAILED",
    };
  }
}

/**
 * The page an invite link opens. Sign-in comes first (the proxy sends a
 * signed-out reader to it and back); the person then sees who invited them,
 * as what, and accepts. No email is sent: the inviter copies this link.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, t] = await Promise.all([params, getTranslations()]);
  const configured = workosAuthenticationConfigured();
  const [read, auth] = await Promise.all([
    configured ? readInvite(token) : { code: "INVITE_UNAVAILABLE" },
    configured ? withAuth({ ensureSignedIn: true }) : null,
  ]);
  const email = auth?.user.email ?? "";
  const refusal =
    "code" in read
      ? read.code
      : auth?.impersonator
        ? "INVITE_IMPERSONATION_REFUSED"
        : read.invite.state === "expired"
          ? "INVITE_EXPIRED"
          : read.invite.state === "accepted"
            ? "INVITE_ALREADY_ACCEPTED"
            : email.toLowerCase() !== read.invite.email.toLowerCase()
              ? "INVITE_EMAIL_MISMATCH"
              : null;
  const invite = "invite" in read ? read.invite : null;
  const roleLabel = invite ? inviteRoleLabels[invite.role] : undefined;
  return (
    <main className="access-main" id="main-content">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        <h1>{t("platform.invite.title")}</h1>
        {invite ? (
          <p>
            {t("platform.invite.description", {
              organization: invite.organizationName,
              email: invite.email,
              role: roleLabel ? t(roleLabel) : invite.role,
            })}
          </p>
        ) : null}
        {email ? <p>{t("platform.invite.signedInAs", { email })}</p> : null}
        {refusal ? (
          <StateBanner
            tone="warning"
            title={t(inviteMessage(refusal), {
              email: invite?.email ?? "",
            })}
          />
        ) : (
          <AcceptInvite token={token} />
        )}
      </section>
    </main>
  );
}
