import { redirect } from "next/navigation";

import { getAuthenticatedHome } from "@/src/features/shell/route-session";

export default async function HomePage() {
  redirect(await getAuthenticatedHome());
}
