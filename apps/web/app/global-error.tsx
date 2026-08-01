"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for an error thrown in the root layout itself.
 *
 * It must render its own `html` and `body` because the failing layout never
 * produced them, and it cannot rely on the design system or the locale catalog
 * for the same reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root layout error", { digest: error.digest });
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main id="main-content">
          <h1>This page could not be loaded</h1>
          <p>
            The application failed to start. Try again, and if it keeps
            happening quote reference {error.digest ?? "unavailable"}.
          </p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
