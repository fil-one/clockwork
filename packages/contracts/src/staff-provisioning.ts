import { z } from "zod";
/** Explicit deployment-owner input; never accepted from a customer request. */
export const StaffProvisioningSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(180),
    role: z.literal("internal_operator"),
  })
  .strict();
export type StaffProvisioning = z.infer<typeof StaffProvisioningSchema>;
