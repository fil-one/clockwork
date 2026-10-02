/** Move browser navigation to the product address while preserving provider
 * callbacks and in-flight mutations on the original service hostname. */
export function commerceCanonicalRedirect(
  request: { url: string; method: string; headers?: Pick<Headers, "get"> },
  canonicalOrigin: string | undefined,
): URL | undefined {
  if (
    canonicalOrigin !== "https://commerce.fil.one" ||
    !["GET", "HEAD"].includes(request.method)
  )
    return;
  const url = new URL(request.url);
  // Next's standalone server can construct request.url with its container
  // hostname/port. The ALB preserves the original HTTP Host header.
  const host = (request.headers?.get("host") ?? url.host).toLowerCase();
  if (
    !["clockwork.fil.one", "clockwork.fil.one:443"].includes(host) ||
    url.pathname === "/auth/callback" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/healthcheck"
  )
    return;
  const destination = new URL(canonicalOrigin);
  destination.pathname = url.pathname;
  destination.search = url.search;
  return destination;
}
