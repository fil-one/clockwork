/** Move browser navigation to the product address while preserving provider
 * callbacks and in-flight mutations on the original service hostname. */
export function commerceCanonicalRedirect(
  request: { url: string; method: string },
  canonicalOrigin: string | undefined,
): URL | undefined {
  if (
    canonicalOrigin !== "https://commerce.fil.one" ||
    !["GET", "HEAD"].includes(request.method)
  )
    return;
  const url = new URL(request.url);
  if (
    url.hostname !== "clockwork.fil.one" ||
    url.pathname === "/auth/callback" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/healthcheck"
  )
    return;
  url.protocol = "https:";
  url.host = "commerce.fil.one";
  return url;
}
