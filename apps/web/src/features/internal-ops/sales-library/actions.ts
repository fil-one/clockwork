"use server";

import { z } from "zod";
import { SalesCollateralInputSchema } from "@clockwork/contracts";
import { attempt } from "../contracts/action-result";
import {
  contractActor,
  contractStaff,
  salesLibraryRepository,
} from "../contracts/server";

/**
 * Adds a link, or saves details of an existing item. PDFs are added and
 * replaced through the upload route, which streams the file.
 */
export async function saveCollateral(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("collateral:manage");
    const { item, expectedVersion } = z
      .object({
        item: z.unknown(),
        expectedVersion: z.number().int().min(1).optional(),
      })
      .strict()
      .parse(raw);
    const input = SalesCollateralInputSchema.parse(item);
    const repository = salesLibraryRepository();
    return expectedVersion === undefined
      ? repository.create(input, null, contractActor(session))
      : repository.update(
          input.id,
          expectedVersion,
          input,
          null,
          contractActor(session),
        );
  });
}
