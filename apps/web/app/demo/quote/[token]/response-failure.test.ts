import { describe, expect, it } from "vitest";

import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

import { recordClientReview } from "@/src/features/customer-partner/partner/demo-client-review";
import { translatorFor } from "@/src/i18n/catalogs";

import {
  clientReviewFailure,
  clientReviewFailureMessages,
  isClientReviewFailure,
} from "./response-failure";

const token = "a".repeat(64);

async function refusal(body: unknown): Promise<unknown> {
  try {
    await recordClientReview(token, body, createMemoryDemoStore());
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("client review refusals", () => {
  // These drive the real recorder, so a change to its wording in the partner
  // lane fails here instead of silently becoming "could not be sent".
  it("names each refusal the recorder throws", async () => {
    expect(
      clientReviewFailure(
        await refusal({
          decision: "decline",
          name: "A",
          note: "",
          authority: true,
        }),
      ),
    ).toBe("invalid");
    expect(
      clientReviewFailure(
        await refusal({
          decision: "request_changes",
          name: "Nora Chen",
          note: "short",
          authority: true,
        }),
      ),
    ).toBe("describeChanges");
    expect(
      clientReviewFailure(
        await refusal({
          decision: "decline",
          name: "Nora Chen",
          note: "",
          authority: true,
        }),
      ),
    ).toBe("expired");
  });

  it("recognizes the recorded-response refusal and never passes text through", () => {
    expect(
      clientReviewFailure(
        new Error(
          "A response is already recorded. Contact your partner to change it.",
        ),
      ),
    ).toBe("alreadyRecorded");
    expect(clientReviewFailure(new SyntaxError("Unexpected token"))).toBe(
      "invalid",
    );
    expect(clientReviewFailure(new Error("database on fire"))).toBe("unsent");
    expect(clientReviewFailure("not an error")).toBe("unsent");
    expect(isClientReviewFailure("expired")).toBe(true);
    expect(isClientReviewFailure("database on fire")).toBe(false);
  });

  it("words every refusal in every language", () => {
    const t = translatorFor("ar");
    for (const id of Object.values(clientReviewFailureMessages))
      expect(t(id)).toMatch(/[؀-ۿ]/u);
  });
});
