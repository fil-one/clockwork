import { eq } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";

/** Resolves only domains whose server-observed verification was persisted. */
export class DatabaseVerifiedPartnerOriginRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async isAllowed(input: {
    origin: string;
    requestId: string;
  }): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(input.origin);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return false;
    const row = await withInternalTransaction(
      this.database,
      input.requestId,
      (transaction) =>
        transaction.query.lifecyclePartnerDomains.findFirst({
          columns: { verifiedAt: true },
          where: eq(lifecyclePartnerDomains.domain, url.hostname.toLowerCase()),
        }),
    );
    return Boolean(row?.verifiedAt);
  }
}
