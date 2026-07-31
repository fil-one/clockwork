import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

const configured = Boolean(
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD,
);
export const GET = configured
  ? handleAuth({
      returnPathname: "/",
      onSuccess: async ({ organizationId }) => {
        if (!organizationId) return;
        await Promise.resolve();
      },
    })
  : (request: Request) => NextResponse.redirect(new URL("/", request.url));
