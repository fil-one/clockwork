import { readFile } from "node:fs/promises";
import {
  applyProductionBootstrap,
  assertBootstrapTarget,
  productionBootstrapDigest,
  validateProductionBootstrap,
} from "../packages/db/src/production-bootstrap";

async function main() {
  const args = process.argv.slice(2);
  const argument = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const path = argument("--manifest");
  if (
    !path ||
    args.some(
      (arg) =>
        arg.startsWith("--") &&
        !["--manifest", "--apply", "--expected-host"].includes(arg),
    )
  )
    throw new Error(
      "Usage: pnpm bootstrap:production --manifest file.json [--apply --expected-host db.example.org]",
    );
  try {
    const manifest = validateProductionBootstrap(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (args.includes("--apply")) {
      const databaseUrl = process.env.DIRECT_DATABASE_URL;
      const expectedHost = argument("--expected-host");
      const authorizationSecret = process.env.AUTHORIZATION_CONTEXT_SECRET;
      if (!databaseUrl || !expectedHost || !authorizationSecret)
        throw new Error("BOOTSTRAP_TARGET_AND_AUTHORIZATION_SECRET_REQUIRED");
      assertBootstrapTarget(manifest, databaseUrl, expectedHost);
      const receipt = await applyProductionBootstrap({
        manifest,
        databaseUrl,
        expectedHost,
        authorizationSecret,
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify({ status: "validated_only", id: manifest.id, manifestHash: productionBootstrapDigest(manifest), targetDatabaseHost: manifest.targetDatabaseHost, staffCount: manifest.staff.length, draftCatalogCount: manifest.catalog.length, providerReferenceCount: manifest.providerReferences.length, mappingCount: manifest.organizationMappings.length, capabilitiesEnabled: false }, null, 2)}\n`,
      );
    }
  } catch (error) {
    // Avoid database errors that can embed bound credential values.
    const message =
      error instanceof Error && /^BOOTSTRAP_[A-Z_]+$/.test(error.message)
        ? error.message
        : "BOOTSTRAP_VALIDATION_OR_DATABASE_OPERATION_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

void main();
