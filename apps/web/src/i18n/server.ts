import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, resolveLocale, translatorFor } from "./index";

// React cache is request-scoped: one visitor's preference cannot leak to another.
export const getLocale = cache(async () =>
  resolveLocale((await cookies()).get(localeCookie)?.value),
);
export const getTranslations = cache(async () =>
  translatorFor(await getLocale()),
);
