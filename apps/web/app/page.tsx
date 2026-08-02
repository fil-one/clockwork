import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  demoPersonaCookieName,
  demoPersonaStartRoute,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "@/src/auth/demo-persona";
import { getAuthenticatedHome } from "@/src/features/shell/route-session";

export default async function HomePage() {
  if (demoPersonaSurfacesEnabled(process.env)) {
    const persona = resolveDemoPersona({
      cookie: (await cookies()).get(demoPersonaCookieName)?.value,
    });
    redirect(persona ? demoPersonaStartRoute(persona.key) : "/demo");
  }
  redirect(await getAuthenticatedHome());
}
