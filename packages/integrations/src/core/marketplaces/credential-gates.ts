import type {
  MarketplaceCredentialGate,
  MarketplaceCredentialStatus,
} from "./types";

export class MarketplaceCredentialGateError extends Error {
  public readonly code = "MARKETPLACE_CREDENTIALS_NOT_CONFIGURED";

  public constructor(
    public readonly provider: "aws" | "azure" | "google",
    public readonly operation: string,
    public readonly missing: readonly string[],
  ) {
    super(
      `${provider.toUpperCase()} marketplace ${operation} is gated; missing ${missing.join(
        ", ",
      )}`,
    );
    this.name = "MarketplaceCredentialGateError";
  }
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

export interface AwsMarketplaceCredentials {
  readonly region?: string;
  readonly mode?: "default_chain" | "assume_role" | "static";
  readonly roleArn?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
}

export class AwsMarketplaceCredentialGate implements MarketplaceCredentialGate {
  public constructor(private readonly credentials: AwsMarketplaceCredentials) {}

  public status(): MarketplaceCredentialStatus {
    const mode = this.credentials.mode ?? "default_chain";
    const missing = [
      ...(present(this.credentials.region) ? [] : ["region"]),
      ...(mode === "assume_role" && !present(this.credentials.roleArn)
        ? ["roleArn"]
        : []),
      ...(mode === "static" && !present(this.credentials.accessKeyId)
        ? ["accessKeyId"]
        : []),
      ...(mode === "static" && !present(this.credentials.secretAccessKey)
        ? ["secretAccessKey"]
        : []),
    ];
    return { provider: "aws", ready: missing.length === 0, missing, mode };
  }

  public assertReady(operation: string): void {
    const status = this.status();
    if (!status.ready)
      throw new MarketplaceCredentialGateError(
        "aws",
        operation,
        status.missing,
      );
  }
}

export interface AzureMarketplaceCredentials {
  readonly tenantId?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export class AzureMarketplaceCredentialGate implements MarketplaceCredentialGate {
  public constructor(
    private readonly credentials: AzureMarketplaceCredentials,
  ) {}

  public status(): MarketplaceCredentialStatus {
    const missing = [
      ...(present(this.credentials.tenantId) ? [] : ["tenantId"]),
      ...(present(this.credentials.clientId) ? [] : ["clientId"]),
      ...(present(this.credentials.clientSecret) ? [] : ["clientSecret"]),
    ];
    return {
      provider: "azure",
      ready: missing.length === 0,
      missing,
      mode: "client_credentials",
    };
  }

  public assertReady(operation: string): void {
    const status = this.status();
    if (!status.ready)
      throw new MarketplaceCredentialGateError(
        "azure",
        operation,
        status.missing,
      );
  }
}

export interface GoogleMarketplaceCredentials {
  readonly projectId?: string;
  readonly serviceAccountEmail?: string;
  readonly privateKey?: string;
}

export class GoogleMarketplaceCredentialGate implements MarketplaceCredentialGate {
  public constructor(
    private readonly credentials: GoogleMarketplaceCredentials,
  ) {}

  public status(): MarketplaceCredentialStatus {
    const missing = [
      ...(present(this.credentials.projectId) ? [] : ["projectId"]),
      ...(present(this.credentials.serviceAccountEmail)
        ? []
        : ["serviceAccountEmail"]),
      ...(present(this.credentials.privateKey) ? [] : ["privateKey"]),
    ];
    return {
      provider: "google",
      ready: missing.length === 0,
      missing,
      mode: "service_account",
    };
  }

  public assertReady(operation: string): void {
    const status = this.status();
    if (!status.ready)
      throw new MarketplaceCredentialGateError(
        "google",
        operation,
        status.missing,
      );
  }
}
