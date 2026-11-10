import "server-only";
import { environmentSigningJourney } from "@clockwork/workflows/signing-journey";
import { getServiceDatabase } from "@/src/db/service";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { recipientResponseHeaders, recipientSigningHandler } from "./http";

export async function handleRecipientRequest(
  request: Request,
  id: string,
  action: string,
) {
  try {
    if (explicitDemoIdentityEnabled()) throw new Error("SIGNING_DEMO_ONLY");
    const journey = environmentSigningJourney(
      getServiceDatabase(),
      process.env,
    );
    if (!journey || !journey.config.origin)
      throw new Error("SIGNING_NOT_CONFIGURED");
    return recipientSigningHandler({
      store: journey.store,
      service: journey.service,
      origin: journey.config.origin,
      secret: journey.config.secret,
      secure: process.env.NODE_ENV === "production",
    })(request, id, action);
  } catch {
    return Response.json(
      { code: "SIGNING_UNAVAILABLE" },
      { status: 503, headers: recipientResponseHeaders },
    );
  }
}
