const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

function httpOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Public origin used for absolute metadata links, never for authorization. */
export function publicMetadataOrigin(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return (
    httpOrigin(environment.CLOCKWORK_CANONICAL_ORIGIN) ??
    httpOrigin(environment.WORKOS_REDIRECT_URI) ??
    LOCAL_DEVELOPMENT_ORIGIN
  );
}
