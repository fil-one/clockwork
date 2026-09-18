import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted((): { client: unknown } => ({ client: undefined }));
vi.mock("./migration-client", () => ({
  createDirectMigrationClient: () => fixture.client,
}));
import {
  applyProductionBootstrap,
  validateProductionBootstrap,
} from "./production-bootstrap";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = ["127.0.0.1", "localhost"].includes(
  new URL(databaseUrl).hostname,
);
if (!local)
  throw new Error("Integration tests require a loopback database URL");
const client = postgres(databaseUrl, { max: 1, ssl: false, prepare: false });
afterAll(() => client.end());

// The complete apply path runs against real tables in a transaction that always
// rolls back. This test never targets a deployed host or leaves bootstrap users.
describe("fresh production bootstrap transaction", () => {
  it("creates real persisted disabled controls, identities, references and an idempotent immutable receipt atomically", async () => {
    const rollback = new Error("ROLLBACK_BOOTSTRAP_FIXTURE");
    const now = new Date();
    const primaryId = crypto.randomUUID();
    const secondaryId = crypto.randomUUID();
    const manifest = validateProductionBootstrap(
      {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        environment: "staging",
        targetDatabaseHost: new URL(databaseUrl).hostname,
        sourceEvidence: "urn:clockwork:integration-only:bootstrap",
        operatorUserId: primaryId,
        identityVerificationAttestation: "verified_with_identity_provider",
        account: {
          id: crypto.randomUUID(),
          legalName: "Bootstrap transaction fixture",
          domain: "bootstrap-fixture.company.com",
          country: "US",
          currency: "USD",
          registeredAddress: {
            line1: "Fixture address",
            city: "Fixture city",
            postalCode: "10001",
            country: "US",
          },
          billingContact: {
            name: "Fixture",
            email: "billing@bootstrap-fixture.company.com",
          },
          apContact: {
            name: "Fixture",
            email: "ap@bootstrap-fixture.company.com",
          },
          invoiceDeliveryEmail: "billing@bootstrap-fixture.company.com",
        },
        organization: {
          id: crypto.randomUUID(),
          name: "Fixture staff",
          workosOrganizationId: "org_INTEGRATIONONLY",
        },
        staff: [
          {
            id: primaryId,
            workosUserId: "user_INTEGRATIONOPERATOR",
            email: "operator@bootstrap-fixture.company.com",
            name: "Operator fixture",
            role: "internal_operator",
            mfaVerifiedAt: now.toISOString(),
            mfaEvidence: "urn:clockwork:integration-only:mfa1",
          },
          {
            id: secondaryId,
            workosUserId: "user_INTEGRATIONFINANCE",
            email: "finance@bootstrap-fixture.company.com",
            name: "Finance fixture",
            role: "finance_approver",
            mfaVerifiedAt: now.toISOString(),
            mfaEvidence: "urn:clockwork:integration-only:mfa2",
          },
        ],
        providerReferences: [
          {
            provider: "billing",
            secretReference: "secret://integration/billing",
            secretVersion: "test-version",
            rotatedAt: now.toISOString(),
            sourceEvidence: "urn:clockwork:integration-only:provider",
          },
        ],
        catalog: [],
        organizationMappings: [
          {
            provider: "fil_one",
            providerOrganizationId: "integration-only-org",
            sourceEvidence: "urn:clockwork:integration-only:mapping",
          },
        ],
      },
      now,
    );
    const result = await client
      .begin(async (tx) => {
        await tx`truncate public.accounts, public.commerce_users, public.price_books, public.system_provider_resource_bindings, private.authorization_secrets, public.system_production_bootstraps cascade`;
        await tx`update public.system_capabilities set enabled = false, recovery_enabled = false`;
        fixture.client = {
          begin: (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
          end: () => Promise.resolve(),
        };
        const input = {
          manifest,
          databaseUrl,
          expectedHost: manifest.targetDatabaseHost,
          authorizationSecret:
            "integration-only-context-secret-not-a-production-value",
          now,
        };
        // A deployment writes the secret under an interim id before it has a
        // manifest. That row still refuses the bootstrap unless it is named
        // for retirement, and then it goes in the bootstrap's own transaction,
        // so the register is never empty at any commit.
        await tx`insert into private.authorization_secrets (id, secret, active) values ('staging-initial', ${input.authorizationSecret}, true)`;
        await expect(applyProductionBootstrap(input)).rejects.toThrow(
          "BOOTSTRAP_REQUIRES_EMPTY_AUTHORIZATION_SECRET_REGISTER",
        );
        const first = await applyProductionBootstrap({
          ...input,
          retireSecretId: "staging-initial",
        });
        expect(first.status).toBe("applied");
        expect(
          (
            await tx<
              { id: string }[]
            >`select id from private.authorization_secrets order by id`
          ).map((row) => row.id),
        ).toEqual([`bootstrap:${manifest.id}`]);
        expect((await applyProductionBootstrap(input)).status).toBe(
          "already_applied",
        );
        // Every later migration run re-applies the same manifest, long after
        // its MFA evidence has aged past the 24-hour window. That is a no-op,
        // not a failure.
        expect(
          (
            await applyProductionBootstrap({
              ...input,
              now: new Date(now.getTime() + 36 * 60 * 60 * 1000),
            })
          ).status,
        ).toBe("already_applied");
        await expect(
          applyProductionBootstrap({
            ...input,
            manifest: { ...manifest, sourceEvidence: "urn:clockwork:changed" },
          }),
        ).rejects.toThrow("BOOTSTRAP_MANIFEST_CONFLICT");
        expect((await tx`select id from public.commerce_users`).length).toBe(2);
        expect(
          (
            await tx`select capability_key from public.system_capabilities where enabled or recovery_enabled`
          ).length,
        ).toBe(0);
        expect(
          (
            await tx`select id from public.audit_events where aggregate_id = ${manifest.id}`
          ).length,
        ).toBe(1);
        expect(
          (
            await tx`select id from public.system_provider_resource_bindings where aggregate_id = ${manifest.organization.id}`
          ).length,
        ).toBe(1);
        const [stored] =
          await tx`select manifest from public.system_production_bootstraps where id = ${manifest.id}`;
        expect(JSON.stringify(stored)).not.toContain(input.authorizationSecret);
        throw rollback;
      })
      .catch((error: unknown) => error);
    expect(result).toBe(rollback);
  });
});
