"use server";

import { cookies } from "next/headers";
import { localeCookie, catalogs } from "@/src/i18n";

export async function saveLanguage(
  _previous: { saved: boolean; error: boolean },
  form: FormData,
) {
  const language = form.get("language");
  if (typeof language !== "string" || !Object.hasOwn(catalogs, language))
    return { saved: false, error: true };
  (await cookies()).set(localeCookie, language, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { saved: true, error: false };
}
