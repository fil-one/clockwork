function httpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The provider returned an invalid navigation URL."); // i18n-exempt: English diagnostic for logs; a surface words its own refusal for the reader (see platform.signing.untrustedUrl)
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("The provider returned an untrusted navigation URL."); // i18n-exempt: English diagnostic for logs; a surface words its own refusal for the reader (see platform.signing.untrustedUrl)
  return url;
}

export function trustedStripePaymentUrl(value: string): string {
  const url = httpsUrl(value);
  if (url.hostname !== "stripe.com" && !url.hostname.endsWith(".stripe.com"))
    throw new Error("Stripe returned an untrusted payment URL."); // i18n-exempt: English diagnostic for logs; a surface words its own refusal for the reader (see platform.signing.untrustedUrl)
  return url.toString();
}

function configuredSigningOrigins(): Set<string> {
  const configured = (process.env.NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (["development", "test"].includes(process.env.NODE_ENV ?? ""))
    configured.push("https://esign.clockwork.test");
  return new Set(configured);
}

export function trustedSigningUrl(value: string): string {
  const url = httpsUrl(value);
  if (!configuredSigningOrigins().has(url.origin))
    throw new Error(
      "The e-sign provider returned a URL outside the allow-list.", // i18n-exempt: English diagnostic for logs; a surface words its own refusal for the reader (see platform.signing.untrustedUrl)
    );
  return url.toString();
}
