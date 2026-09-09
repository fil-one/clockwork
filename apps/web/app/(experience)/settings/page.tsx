import { redirect } from "next/navigation";
import { AppShell } from "@/src/features/shell/app-shell";
import {
  getAuthenticatedHome,
  getRouteSession,
} from "@/src/features/shell/route-session";
import { LanguageSettings } from "./language-settings";

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
  return (
    <AppShell audience={audience} session={session}>
      <LanguageSettings />
    </AppShell>
  );
}
