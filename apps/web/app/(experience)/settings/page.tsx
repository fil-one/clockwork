import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessTokensSection } from "@/src/features/internal-ops/access-tokens/access-tokens";
import { loadOwnAccessTokens } from "@/src/features/internal-ops/access-tokens/server";
import { AppShell } from "@/src/features/shell/app-shell";
import { publicMetadataOrigin } from "@/src/features/shell/public-origin";
import {
  getAuthenticatedHome,
  getRouteSession,
} from "@/src/features/shell/route-session";
import { getTranslations } from "@/src/i18n/server";
import { LanguageSettings } from "./language-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("settings.title") };
}

export default async function SettingsPage() {
  const home = await getAuthenticatedHome();
  if (home === "/choose-organization" || home === "/access/mfa") redirect(home);
  const audience =
    home === "/internal"
      ? "internal"
      : home === "/partner"
        ? "partner"
        : "customer";
  const session = await getRouteSession(audience);
  // Staff manage their MCP access tokens here, beside their language.
  const tokens = audience === "internal" ? await loadOwnAccessTokens() : null;
  return (
    <AppShell audience={audience} session={session}>
      <LanguageSettings>
        {tokens ? (
          <AccessTokensSection
            view={tokens}
            endpoint={`${publicMetadataOrigin(process.env)}/api/mcp`}
          />
        ) : null}
      </LanguageSettings>
    </AppShell>
  );
}
