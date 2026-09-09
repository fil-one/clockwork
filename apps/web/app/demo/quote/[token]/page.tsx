import { notFound } from "next/navigation";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { clientReview } from "@/src/features/customer-partner/partner/demo-client-review";
import { ClientQuoteReview } from "./review";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review your quotation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!demoDeployIdentityEnabled(process.env)) notFound();
  const { token } = await params;
  const view = clientReview(await configuredDemoStateStore().read(), token);
  if (!view)
    return (
      <main>
        <h1>Quote link unavailable</h1>
        <p>
          This quote has expired or been replaced. Ask your partner for the
          current quotation.
        </p>
      </main>
    );
  return <ClientQuoteReview token={token} quote={view} />;
}
