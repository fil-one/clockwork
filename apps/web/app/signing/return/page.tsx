import { signingFixture } from "@/src/features/shared/demo-data";
import { SigningExperience } from "@/src/features/signing/signing-experience";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const verified =
    query.envelope === signingFixture.envelope &&
    query.status === signingFixture.status &&
    query.hash === signingFixture.hash;
  return <SigningExperience mode="return" verified={verified} />;
}
