import { z } from "zod";
import {
  contractSignerEmail,
  mndaSignerEmail,
  mndaSigning,
  type SigningJourneyKind,
} from "@clockwork/contracts";
import {
  ContractDocumentStores,
  ContractRepository,
  ContractSigningRepository,
  MndaRepository,
  PostgresContractDocumentStore,
  SigningJourneyRepository,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  SignWellClient,
  SignWellContractClient,
  contractCopiedContacts,
  signWellCopiedContacts,
  staffNotificationChannels,
} from "@clockwork/integrations";
import { MndaWorkflow } from "../mnda";
import { ContractSigningWorkflow } from "../contracts";
import { SigningJourneyService, type JourneySource } from "./service";

type Environment = Readonly<Record<string, string | undefined>>;

export function signingJourneyConfiguration(env: Environment) {
  const enabled = env.COMMERCE_SIGNING_EXPERIENCE === "fil_one";
  const secret = env.COMMERCE_SIGNING_LINK_SECRET ?? "";
  const applicationId = env.SIGNWELL_API_APPLICATION_ID ?? "";
  let origin: string | null = null;
  try {
    const url = new URL(env.COMMERCE_SIGNING_ORIGIN ?? "");
    if (
      (url.protocol === "https:" ||
        (env.NODE_ENV !== "production" &&
          url.hostname === "localhost" &&
          url.protocol === "http:")) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      origin = url.origin;
  } catch {
    /* Missing configuration is reported by readiness. */
  }
  // Explicit external-recipient channel: staff settings/preferences must not
  // accidentally suppress legal invitations or authorize external mail.
  const email = staffNotificationChannels({
    ...env,
    COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER: env.COMMERCE_SIGNING_EMAIL_PROVIDER,
    COMMERCE_NOTIFICATIONS_EMAIL_FROM: env.COMMERCE_SIGNING_EMAIL_FROM,
    COMMERCE_NOTIFICATIONS_SES_REGION: env.COMMERCE_SIGNING_SES_REGION,
    COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL: undefined,
  }).email;
  const ready = Boolean(
    origin &&
    secret.length >= 32 &&
    z.uuid().safeParse(applicationId).success &&
    email.configured &&
    env.SIGNWELL_API_KEY &&
    env.SIGNWELL_WEBHOOK_ID,
  );
  return {
    enabled,
    ready,
    origin,
    secret,
    applicationId,
    email,
    testRecipients: new Set(
      (env.COMMERCE_SIGNING_TEST_RECIPIENTS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

/** Fail before creating/sending anything if the branded journey was selected
 * without its delivery channel. Turning off creation keeps old links working. */
export function signingCreationOptions(env: Environment) {
  const config = signingJourneyConfiguration(env);
  if (!config.enabled) return undefined;
  if (!config.ready || !config.origin)
    throw new Error("SIGNING_JOURNEY_NOT_CONFIGURED");
  return {
    applicationId: config.applicationId,
    logoUrl: `${config.origin}/brand/fo-wordmark-dark.png`,
  };
}

export function environmentSigningJourney(
  db: RuntimeDatabase,
  env: Environment,
) {
  const config = signingJourneyConfiguration(env);
  if (!config.ready || !config.origin || !config.email.configured) return null;
  const key = env.SIGNWELL_API_KEY;
  if (!key) return null;
  const mndas = new MndaRepository(db);
  const stores = () => {
    if ((env.COMMERCE_DOCUMENT_STORE ?? "postgres") !== "postgres")
      throw new Error("DOCUMENT_BACKEND_UNAVAILABLE");
    return new ContractDocumentStores(new PostgresContractDocumentStore(db));
  };
  const contracts = new ContractSigningRepository(db, stores);
  const register = new ContractRepository(db, stores);
  const mndaClient = new SignWellClient(key);
  const contractClient = new SignWellContractClient(key);
  const actor = { kind: "system" as const, id: "recipient-signing" };
  const source = async (
    kind: SigningJourneyKind,
    id: string,
  ): Promise<JourneySource> => {
    if (kind === "mnda") {
      const r = await mndas.get(id);
      return {
        kind,
        id,
        version: r.version,
        providerId: r.providerId,
        title: mndaSigning.documentName(r),
        templateHash: r.templateHash,
        testMode: r.testMode,
        state: r.state,
        pendingCorrection: Boolean(r.pendingSignerEmail),
        signers: [
          {
            id: "counterparty",
            name: r.input.signerName,
            email: mndaSignerEmail(r),
          },
          {
            id: "fil-one",
            name: r.countersigner.name,
            email: r.countersigner.email,
          },
        ],
        copies: signWellCopiedContacts(r),
        pdf: () => mndas.readArtifact(id, "executed"),
        refresh: () => new MndaWorkflow(mndas, mndaClient).sync(id, actor),
      };
    }
    const r = await contracts.get(id);
    return {
      kind,
      id,
      version: r.version,
      providerId: r.providerId,
      title: r.documentName,
      templateHash: r.templateHash,
      testMode: r.testMode,
      state: r.state,
      pendingCorrection: Boolean(r.pendingSignerEmail),
      signers: [
        ...(r.counterpartySigns
          ? [
              {
                id: "counterparty",
                name: r.counterpartySigner.name,
                email: contractSignerEmail(r),
              },
            ]
          : []),
        {
          id: "fil-one",
          name: r.countersigner.name,
          email: r.countersigner.email,
        },
      ],
      copies: contractCopiedContacts(r),
      pdf: async () => {
        const detail = await register.get(
          id,
          new Date().toISOString().slice(0, 10),
        );
        const file = detail.files.filter((f) => f.kind === "executed").at(-1);
        if (!file) throw new Error("SIGNING_EVIDENCE_UNAVAILABLE");
        return (await register.readFile(id, file.id)).bytes;
      },
      refresh: () =>
        new ContractSigningWorkflow(contracts, contractClient).sync(id, actor),
    };
  };
  const store = new SigningJourneyRepository(db);
  return {
    store,
    config,
    service: new SigningJourneyService({
      store,
      source,
      document: (kind, id) =>
        kind === "mnda" ? mndaClient.get(id) : contractClient.get(id),
      email: config.email.port,
      origin: config.origin,
      linkSecret: config.secret,
      testRecipients: config.testRecipients,
    }),
  };
}
