"use server";

import { signOut } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { releaseProofCookieName } from "@/src/auth/release-proof";
import {
  assistedSessionCookieName,
  getCommerceSession,
} from "@/src/auth/session";

/**
 * Ends the current session for every authentication source.
 *
 * Provider sign-out alone is not sufficient: an assisted session and a release
 * proof session are carried by their own cookies, so a signed-out browser would
 * otherwise retain an effective account. Both are cleared before the provider
 * call, and the local and proof sources fall through to a plain redirect
 * because they have no provider session to end.
 */
export async function signOutCommerceSession(): Promise<never> {
  let authenticationSource: "local" | "workos" | "release-proof" = "local";
  try {
    ({ authenticationSource } = await getCommerceSession());
  } catch {
    // An unreadable or already-expired session still clears its cookies.
  }

  const cookieStore = await cookies();
  cookieStore.delete(assistedSessionCookieName);
  cookieStore.delete(releaseProofCookieName);

  if (authenticationSource === "workos") await signOut({ returnTo: "/" });
  redirect("/");
}
