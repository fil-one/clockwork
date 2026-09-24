import type { Metadata } from "next";

import { SigningExperience } from "@/src/features/signing/signing-experience";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("signing.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const state = typeof query.state === "string" ? query.state : "";
  return <SigningExperience mode="return" returnState={state} />;
}
