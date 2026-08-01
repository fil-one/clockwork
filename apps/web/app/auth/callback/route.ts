import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { resolveWorkosIdentity } from "@clockwork/db";

import { getServiceDatabase } from "@/src/db/service";

const configured = Boolean(
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD,
);
export const GET = configured
  ? handleAuth({
      returnPathname: "/",
      onSuccess: async ({ organizationId, user }) => {
        if (!organizationId) return;
        await resolveWorkosIdentity(getServiceDatabase(), {
          workosUserId: user.id,
          workosOrganizationId: organizationId,
          requestId: `auth-callback:${crypto.randomUUID()}`,
        });
      },
    })
  : (request: Request) => NextResponse.redirect(new URL("/", request.url));
