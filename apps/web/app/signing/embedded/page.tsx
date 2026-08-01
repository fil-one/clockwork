import { SigningExperience } from "@/src/features/signing/signing-experience";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agreementId?: string }>;
}) {
  const agreementId = (await searchParams).agreementId?.trim();
  if (!agreementId && process.env.NODE_ENV === "production")
    return (
      <main id="main-content">
        <h1>Choose an agreement first</h1>
        <p>Start signing from an authorized agreement record.</p>
      </main>
    );
  return (
    <SigningExperience
      mode="embedded"
      {...(agreementId ? { agreementId } : {})}
    />
  );
}
