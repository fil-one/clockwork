import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";
import { recordClientReview } from "@/src/features/customer-partner/partner/demo-client-review";

import { clientReviewFailure } from "../response-failure";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!demoDeployIdentityEnabled(process.env))
    return new Response(null, { status: 404 });
  const cookies = Object.fromEntries(
    (request.headers.get("cookie") ?? "").split(";").map((item) => {
      const i = item.indexOf("=");
      return [item.slice(0, i).trim(), item.slice(i + 1)];
    }),
  );
  const secret = demoAccessConfiguration(process.env);
  if (
    secret &&
    !(await verifyDemoAccessCookie(cookies[demoAccessCookieName], secret))
  )
    return new Response(null, { status: 401 });
  const { validateDemoMutationProof } =
    await import("@/app/api/[[...route]]/demo-app");
  const proofFailure = validateDemoMutationProof(request);
  if (proofFailure) return proofFailure;
  try {
    if (Number(request.headers.get("content-length")) > 12000)
      return new Response(null, { status: 413 });
    const bytes = await request.text();
    if (bytes.length > 12000) return new Response(null, { status: 413 });
    const result = await recordClientReview(
      (await params).token,
      JSON.parse(bytes),
    );
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    // A code, not a sentence: the review page words it in the client's
    // language, and the refusal's English text never reaches the reader.
    return Response.json(
      { code: clientReviewFailure(error) },
      { status: 422, headers: { "cache-control": "private, no-store" } },
    );
  }
}
