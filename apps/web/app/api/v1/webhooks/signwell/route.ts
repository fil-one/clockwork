import { verifySignWellWakeup } from "@clockwork/integrations";
import {
  mndaRepository,
  mndaWorkflow,
} from "@/src/features/internal-ops/mnda/server";
import {
  contractSigningRepository,
  contractSigningWorkflow,
} from "@/src/features/internal-ops/contracts/server";

export async function POST(request: Request) {
  if (!process.env.SIGNWELL_WEBHOOK_ID)
    return new Response(null, { status: 503 });
  // Stream-bound even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  let providerId: string;
  try {
    providerId = verifySignWellWakeup(
      Buffer.concat(chunks).toString("utf8"),
      process.env.SIGNWELL_WEBHOOK_ID,
    );
  } catch {
    return new Response(null, { status: 401 });
  }
  try {
    const record = await mndaRepository().byProvider(providerId);
    if (record)
      await mndaWorkflow().sync(record.id, {
        kind: "provider",
        id: "signwell",
      });
    else {
      // Template contracts share the SignWell account; same wakeup rule.
      const contract = await contractSigningRepository().byProvider(providerId);
      if (contract)
        await contractSigningWorkflow("sync").sync(contract.contractId, {
          kind: "provider",
          id: "signwell",
        });
    }
    return Response.json({ received: true });
  } catch {
    return new Response(null, { status: 503 });
  }
}
