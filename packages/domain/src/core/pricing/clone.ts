import { z } from "zod";

/** Destination identity is the command ID; source concurrency is explicit. */
export const PriceBookCloneCommandSchema = z
  .object({
    sourceId: z.uuid(),
    sourceRowVersion: z.number().int().positive().max(2_147_483_647),
    name: z.string().trim().min(3).max(120),
    version: z.number().int().positive().max(2_147_483_647),
    effectiveFrom: z.iso
      .date()
      .refine(
        (value) => value >= "0001-01-01",
        "Use a supported calendar date",
      ),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();

/** A copied discount configuration is a fresh policy, not a reused approval. */
export function clonedDiscountMatrix<T>(matrix: T, destinationId: string): T {
  const copy = structuredClone(matrix);
  if (copy && typeof copy === "object" && "id" in copy && "version" in copy)
    return { ...copy, id: `discount-${destinationId}`, version: 1 };
  return copy;
}
