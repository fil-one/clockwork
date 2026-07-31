import type { AuthorizationContext } from "@clockwork/domain";

export interface RequestContext {
  requestId: string;
  receivedAt: Date;
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  authorization: AuthorizationContext | null;
  rawWebhookBody?: Uint8Array;
}

export interface ApiVariables {
  requestContext: RequestContext;
}
