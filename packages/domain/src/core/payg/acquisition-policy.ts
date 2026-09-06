import { z } from "zod";
const reference = z
  .object({
    documentId: z.string().trim().min(1).max(255),
    version: z.string().trim().min(1).max(80),
    uri: z
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "Use an HTTPS document reference without credentials, queries or fragments"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const CustomerAcquisitionPolicySchema = z
  .object({
    paygRequestsEnabled: z.boolean(),
    trialRequestsEnabled: z.boolean(),
    serviceNotice: z.string().trim().min(20).max(4000),
    cancellationNotice: z.string().trim().min(20).max(4000),
    trialNotice: z.string().trim().min(20).max(4000),
    terms: reference,
    retention: reference,
  })
  .strict();
export type CustomerAcquisitionPolicy = z.infer<
  typeof CustomerAcquisitionPolicySchema
>;
