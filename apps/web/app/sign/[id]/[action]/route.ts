import { handleRecipientRequest } from "@/src/features/recipient-signing/server";

type Context = { params: Promise<{ id: string; action: string }> };
async function handle(request: Request, context: Context) {
  const { id, action } = await context.params;
  return handleRecipientRequest(request, id, action);
}
export const GET = handle;
export const POST = handle;
