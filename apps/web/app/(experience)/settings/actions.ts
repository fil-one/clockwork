"use server";

import { cookies } from "next/headers";
import { isLocale, localeCookie, localeCookieOptions } from "@/src/i18n";

export async function saveLanguage(
  _previous: { saved: boolean; error: boolean },
  form: FormData,
) {
  const language = form.get("language");
  if (!isLocale(language)) return { saved: false, error: true };
  (await cookies()).set(localeCookie, language, {
    ...localeCookieOptions,
    secure: process.env.NODE_ENV === "production",
  });
  return { saved: true, error: false };
}
