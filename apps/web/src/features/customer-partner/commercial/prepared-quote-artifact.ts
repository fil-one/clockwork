export type PreparedQuoteArtifactLookup =
  | { status: "stored"; documentId: string; artifactId: string }
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "forbidden" };

export type BuyQuoteProjectionLookup =
  | {
      status: "found";
      quoteStatus: string;
      rowVersion: number;
      totalMinor?: string;
      currency?: "USD" | "EUR" | "GBP";
      marginResult?: string | undefined;
    }
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "forbidden" };

export type LookupPreparedQuoteArtifact = (
  quoteId: string,
) => Promise<PreparedQuoteArtifactLookup>;

export type LookupBuyQuoteProjection = (
  quoteId: string,
) => Promise<BuyQuoteProjectionLookup>;
