import { z } from "zod";
import { uuidV7 } from "@clockwork/contracts";
import {
  recipientAccessToken,
  recipientSessionLifetimeSeconds,
  verifyRecipientAccess,
} from "@clockwork/integrations";
import type { SigningJourneyStore } from "@clockwork/db";
import type { SigningJourneyService } from "@clockwork/workflows/signing-journey";

export const recipientResponseHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

interface Dependencies {
  store: SigningJourneyStore;
  service: Pick<
    SigningJourneyService,
    "sourceFor" | "view" | "launch" | "refresh" | "download"
  >;
  origin: string;
  secret: string;
  secure: boolean;
}

const json = (
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(
    status >= 400
      ? {
          type: "about:blank",
          title: "Signing request could not be completed",
          status,
          ...z.object({ code: z.string() }).parse(data),
          requestId: uuidV7(),
          retryable: status >= 500 || status === 429,
        }
      : data,
    {
      status,
      headers: {
        ...recipientResponseHeaders,
        ...(status >= 400
          ? { "content-type": "application/problem+json" }
          : {}),
        ...extra,
      },
    },
  );

async function boundedToken(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256) {
      await reader.cancel();
      throw new Error("SIGNING_ACCESS_INVALID");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Link capabilities are exchanged in a POST body. They never appear in a
 * server URL, a redirect Location, returned JSON, or a readable cookie. */
export function recipientSigningHandler(deps: Dependencies) {
  return async (request: Request, id: string, action: string) => {
    if (!z.uuid().safeParse(id).success)
      return json({ code: "SIGNING_ACCESS_INVALID" }, 404);
    const write = ["access", "launch", "refresh"].includes(action);
    if (
      (write && request.method !== "POST") ||
      (!write && request.method !== "GET")
    )
      return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (write && request.headers.get("origin") !== deps.origin)
      return json({ code: "SIGNING_ORIGIN_INVALID" }, 403);
    try {
      const recipient = await deps.store.recipient(id);
      if (!recipient) return json({ code: "SIGNING_ACCESS_INVALID" }, 404);
      const cookieName = `cw_sign_${id.replaceAll("-", "")}`;
      const cookie =
        request.headers
          .get("cookie")
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) ?? "";
      const token = action === "access" ? await boundedToken(request) : cookie;
      const expires = verifyRecipientAccess(recipient, token, deps.secret);
      if (!expires) return json({ code: "SIGNING_ACCESS_INVALID" }, 401);
      await deps.service.sourceFor(recipient);
      if (action === "access") {
        const expiry = Math.min(
          expires,
          Math.floor(Date.now() / 1000) + recipientSessionLifetimeSeconds,
        );
        const session = recipientAccessToken(recipient, deps.secret, expiry);
        await deps.store.recordAccess(id, "opened");
        // i18n-exempt: Set-Cookie protocol attributes, not interface text.
        return json(await deps.service.view(recipient), 200, {
          "set-cookie": `${cookieName}=${session}; Path=/sign/${id}; HttpOnly; SameSite=Strict; Max-Age=${expiry - Math.floor(Date.now() / 1000)}${deps.secure ? "; Secure" : ""}`,
        });
      }
      if (action === "status") return json(await deps.service.view(recipient));
      if (action === "file")
        return new Response(
          Buffer.from(await deps.service.download(recipient)),
          {
            headers: {
              ...recipientResponseHeaders,
              "content-type": "application/pdf",
              "content-disposition":
                'attachment; filename="Fil-One-Signed-Agreement.pdf"',
            },
          },
        );
      if (action === "launch" || action === "refresh") {
        if (!(await deps.store.reserveProviderRead(id)))
          return json({ code: "SIGNING_TRY_AGAIN" }, 429, {
            "retry-after": "10",
          });
        return json(
          action === "launch"
            ? { url: await deps.service.launch(recipient) }
            : await deps.service.refresh(recipient),
        );
      }
      return json({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        [
          "SIGNING_ACCESS_INVALID",
          "MNDA_NOT_FOUND",
          "CONTRACT_NOT_FOUND",
          "CONTRACT_SIGNING_NOT_FOUND",
        ].includes(message)
      )
        return json({ code: "SIGNING_ACCESS_INVALID" }, 401);
      if (["SIGNING_NOT_READY", "SIGNING_NOT_COMPLETED"].includes(message))
        return json({ code: "SIGNING_NOT_READY" }, 409);
      return json({ code: "SIGNING_UNAVAILABLE" }, 503);
    }
  };
}
