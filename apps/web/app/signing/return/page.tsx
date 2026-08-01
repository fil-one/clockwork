import { SigningExperience } from "@/src/features/signing/signing-experience";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const state = typeof query.state === "string" ? query.state : "";
  return <SigningExperience mode="return" returnState={state} />;
}
