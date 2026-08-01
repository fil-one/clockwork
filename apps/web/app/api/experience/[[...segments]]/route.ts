import { handleExperienceRequest } from "@/src/features/experience-server/controller";

type RouteContext = { params: Promise<{ segments?: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const { segments = [] } = await context.params;
  return handleExperienceRequest(request, segments);
}

export const GET = handle;
export const POST = handle;
