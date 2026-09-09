import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
export async function POST(request: Request) {
  if (!demoDeployIdentityEnabled(process.env))
    return new Response(null, { status: 404 });
  const demo = await import("@/app/api/[[...route]]/demo-app");
  return demo.handleDemoProvisionOrder(request);
}
