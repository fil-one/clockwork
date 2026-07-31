import { resolveTxt } from "node:dns/promises";

export interface DomainOwnershipVerificationResult {
  verifiedAt: string;
  evidenceReference: string;
}

export interface DomainOwnershipVerifier {
  verify(input: {
    domain: string;
    verificationToken: string;
    requestId: string;
  }): Promise<DomainOwnershipVerificationResult>;
}

type TxtResolver = (
  hostname: string,
) => Promise<readonly (readonly string[])[]>;

function normalizedDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    domain
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("DOMAIN_OWNERSHIP_DOMAIN_INVALID");
  return domain;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

/**
 * Server-side DNS proof. The caller supplies the challenge value but cannot
 * attest the result: the resolver must observe the exact TXT record beneath
 * the requested domain before persistence is allowed.
 */
export class DnsTxtDomainOwnershipVerifier implements DomainOwnershipVerifier {
  public constructor(
    private readonly resolver: TxtResolver = resolveTxt,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async verify(
    input: Parameters<DomainOwnershipVerifier["verify"]>[0],
  ): Promise<DomainOwnershipVerificationResult> {
    const domain = normalizedDomain(input.domain);
    if (
      input.verificationToken.length < 16 ||
      input.verificationToken.length > 255 ||
      hasControlCharacter(input.verificationToken)
    )
      throw new Error("DOMAIN_OWNERSHIP_TOKEN_INVALID");
    const hostname = `_clockwork-domain.${domain}`;
    const expected = `clockwork-verification=${input.verificationToken}`;
    let records: readonly (readonly string[])[];
    try {
      records = await this.resolver(hostname);
    } catch {
      throw new Error("DOMAIN_OWNERSHIP_PROOF_NOT_FOUND");
    }
    if (!records.some((parts) => parts.join("") === expected))
      throw new Error("DOMAIN_OWNERSHIP_PROOF_MISMATCH");
    return {
      verifiedAt: this.now().toISOString(),
      evidenceReference: `dns-txt:${hostname}`,
    };
  }
}
