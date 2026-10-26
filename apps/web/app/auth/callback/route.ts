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
      ...(process.env.APP_ORIGIN ? { baseURL: process.env.APP_ORIGIN } : {}),
      // AuthKit saves the session before onSuccess; a lookup failure there
      // turns a successful login into an error response with a live cookie.
      // Commerce membership and permissions are checked by getCommerceSession
      // on the destination page and every protected operation.
    })
  : (request: Request) => NextResponse.redirect(new URL("/", request.url));
