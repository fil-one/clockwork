"use server";

import { signOut } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { demoPersonaCookieName } from "@/src/auth/demo-persona";
import { releaseProofCookieName } from "@/src/auth/release-proof";
import {
  assistedSessionCookieName,
  getCommerceSession,
} from "@/src/auth/session";

/**
 * Ends the current session for every authentication source.
 *
 * Provider sign-out alone is not sufficient: an assisted session, a release
 * proof session, and a demo persona are each carried by their own cookie, so a
 * signed-out browser would otherwise retain an effective account. All three are
 * cleared before the provider call, and the local and proof sources fall
 * through to a plain redirect because they have no provider session to end.
 *
 * The persona cookie matters most on a demo deploy, where the home route reads
 * it and sends the browser straight back into the persona it just left. Leaving
 * it behind makes signing out look like it did nothing.
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
  cookieStore.delete(demoPersonaCookieName);

  if (authenticationSource === "workos") await signOut({ returnTo: "/" });
  redirect("/");
}
