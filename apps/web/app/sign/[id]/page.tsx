import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RecipientSigningPage } from "@/src/features/recipient-signing/signing-page";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";

export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const preview =
    id === "preview" &&
    (process.env.NODE_ENV === "development" || explicitDemoIdentityEnabled());
  if (!preview && !z.uuid().safeParse(id).success) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <RecipientSigningPage
      id={id}
      {...(nonce ? { nonce } : {})}
      {...(preview ? { preview: true } : {})}
    />
  );
}
