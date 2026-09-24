import {
  demoJourneys,
  type DemoJourney,
  type DemoJourneyKey,
} from "@clockwork/testing/demo-journeys";
import {
  DEMO_PERSONA_HEADER,
  demoAccountIds,
  demoPersonas,
  type DemoPersona,
  type DemoPersonaKey,
} from "@clockwork/testing/personas";
import { pristineDemoSeed } from "@clockwork/testing/demo-seed";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import type { AuthorizedMembership } from "@/src/auth/identity-repository";
import type { MessageId, MessageValues, Translator } from "@/src/i18n";
import type { DemoJourneyView } from "@/src/features/shell/demo-persona-switcher";
import type { ExperienceAudience } from "@/src/features/shell/navigation";

export { DEMO_PERSONA_HEADER };
export const demoPersonaCookieName = "clockwork-demo-persona";
export const demoPersonaCookieLifetimeSeconds = 12 * 60 * 60;

/**
 * The persona surfaces exist only on a deliberate demo deploy. Without the
 * opt-in the cookie is never read and the header keeps the role-only meaning it
 * has always had, so an unflagged environment behaves exactly as before.
 */
export function demoPersonaSurfacesEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return demoDeployIdentityEnabled(environment);
}

export function isDemoPersonaKey(value: string): value is DemoPersonaKey {
  return Object.hasOwn(demoPersonas, value);
}

export const demoPersonaCatalog: readonly DemoPersona[] = Object.values(
  demoPersonas,
).toSorted((left, right) => left.displayName.localeCompare(right.displayName));

/**
 * The header decides on its own. Playwright suites send a commerce role here,
 * which is never a persona key, so those runs resolve to no persona and keep
 * the legacy demo identity even if a persona cookie is present in the context.
 */
export function resolveDemoPersona(input: {
  header?: string | null | undefined;
  cookie?: string | null | undefined;
}): DemoPersona | undefined {
  const header = input.header?.trim();
  if (header)
    return isDemoPersonaKey(header) ? demoPersonas[header] : undefined;
  const cookie = input.cookie?.trim();
  return cookie && isDemoPersonaKey(cookie) ? demoPersonas[cookie] : undefined;
}

export function demoJourneyForPersona(
  persona: DemoPersonaKey,
): DemoJourney | undefined {
  return Object.values(demoJourneys).find(
    (journey) => journey.persona === persona,
  );
}

/**
 * The words that go with each persona, in the reader's language. The persona
 * catalog in `@clockwork/testing` holds only facts and cannot import message
 * IDs, so the copy is keyed by persona here; a persona without both messages
 * is a type error.
 */
export const demoPersonaCopy = {
  billingUser: {
    jobTitle: "demo.persona.billingUser.jobTitle",
    intent: "demo.persona.billingUser.intent",
  },
  directBuyer: {
    jobTitle: "demo.persona.directBuyer.jobTitle",
    intent: "demo.persona.directBuyer.intent",
  },
  distributor: {
    jobTitle: "demo.persona.distributor.jobTitle",
    intent: "demo.persona.distributor.intent",
  },
  endClient: {
    jobTitle: "demo.persona.endClient.jobTitle",
    intent: "demo.persona.endClient.intent",
  },
  financeApprover: {
    jobTitle: "demo.persona.financeApprover.jobTitle",
    intent: "demo.persona.financeApprover.intent",
  },
  internalOperator: {
    jobTitle: "demo.persona.internalOperator.jobTitle",
    intent: "demo.persona.internalOperator.intent",
  },
  legalApprover: {
    jobTitle: "demo.persona.legalApprover.jobTitle",
    intent: "demo.persona.legalApprover.intent",
  },
  referralPartner: {
    jobTitle: "demo.persona.referralPartner.jobTitle",
    intent: "demo.persona.referralPartner.intent",
  },
  reseller: {
    jobTitle: "demo.persona.reseller.jobTitle",
    intent: "demo.persona.reseller.intent",
  },
} as const satisfies Record<
  DemoPersonaKey,
  { readonly jobTitle: MessageId; readonly intent: MessageId }
>;

export function demoPersonaJobTitle(
  persona: DemoPersonaKey,
  t: Translator,
): string {
  return t(demoPersonaCopy[persona].jobTitle);
}

/** The task a persona came to the demo to do, as the persona picker shows it. */
export function demoPersonaIntent(
  persona: DemoPersonaKey,
  t: Translator,
): string {
  return t(demoPersonaCopy[persona].intent);
}

/** A persona as the demo controls list it: the name and the job title. */
export function demoPersonaChoiceLabel(
  persona: DemoPersona,
  t: Translator,
): string {
  return t("demo.persona.option", {
    name: persona.displayName,
    jobTitle: demoPersonaJobTitle(persona.key, t),
  });
}

interface DemoJourneyStepCopy {
  readonly message: MessageId;
  /** Facts the step names, such as an account; never translated. */
  readonly values?: MessageValues;
}

type DemoJourneyStepRoute<K extends DemoJourneyKey> =
  (typeof demoJourneys)[K]["steps"][number]["route"];

/**
 * A journey's heading and one message per step, keyed by the step's route
 * (unique within a journey). A journey step without a message is a type error.
 */
type DemoJourneyCopy = {
  readonly [K in DemoJourneyKey]: {
    readonly title: MessageId;
    readonly steps: {
      readonly [R in DemoJourneyStepRoute<K>]: DemoJourneyStepCopy;
    };
  };
};

function demoAccountName(accountId: string): string {
  return (
    pristineDemoSeed.accounts.find((account) => account.id === accountId)
      ?.name ?? accountId
  );
}

export const demoJourneyCopy: DemoJourneyCopy = {
  directBuyerRenewal: {
    title: "demo.journey.directBuyerRenewal.title",
    steps: {
      "/dashboard": {
        message: "demo.journey.directBuyerRenewal.openRenewal",
      },
      "/quotes/quote-direct-renewal-v2": {
        message: "demo.journey.directBuyerRenewal.reviewIssued",
      },
    },
  },
  referralDispute: {
    title: "demo.journey.referralDispute.title",
    steps: {
      "/partner/registrations": {
        message: "demo.journey.referralDispute.locateDeal",
      },
      "/partner/disputes": {
        message: "demo.journey.referralDispute.reviewClock",
      },
    },
  },
  resellerAgreementAndQuote: {
    title: "demo.journey.resellerAgreementAndQuote.title",
    steps: {
      "/partner": {
        message: "demo.journey.resellerAgreementAndQuote.reviewAgreement",
      },
      "/partner/quotes/quote-resale-customer-v4": {
        message: "demo.journey.resellerAgreementAndQuote.completeQuote",
      },
    },
  },
  distributorException: {
    title: "demo.journey.distributorException.title",
    steps: {
      "/partner/portfolio": {
        message: "demo.journey.distributorException.openClient",
        values: { client: demoAccountName(demoAccountIds.ukEndClient) },
      },
      "/partner/quotes/quote-distributor-exception-v1": {
        message: "demo.journey.distributorException.reviewApproval",
      },
    },
  },
  endClientUsage: {
    title: "demo.journey.endClientUsage.title",
    steps: {
      "/services": { message: "demo.journey.endClientUsage.reviewUsage" },
    },
  },
  billingRecovery: {
    title: "demo.journey.billingRecovery.title",
    steps: {
      "/billing/invoice-meridian-overdue": {
        message: "demo.journey.billingRecovery.reviewFailure",
      },
      "/billing/invoice-meridian-paid": {
        message: "demo.journey.billingRecovery.downloadReceipt",
      },
    },
  },
  legalCustomerPaper: {
    title: "demo.journey.legalCustomerPaper.title",
    steps: {
      "/internal/queues/queue-legal-meridian": {
        message: "demo.journey.legalCustomerPaper.switchVersion",
      },
    },
  },
  financeApproval: {
    title: "demo.journey.financeApproval.title",
    steps: {
      "/internal/queues/queue-price-harborline": {
        message: "demo.journey.financeApproval.reviewTerms",
      },
    },
  },
  internalProvisioningRecovery: {
    title: "demo.journey.internalProvisioningRecovery.title",
    steps: {
      "/internal/queues/queue-provision-cobalt": {
        message: "demo.journey.internalProvisioningRecovery.enterAssisted",
      },
      "/internal/accounts/cobalt-orchard": {
        message: "demo.journey.internalProvisioningRecovery.verifyActors",
      },
    },
  },
};

/**
 * The persona's guided journey as the demo controls show it, in the reader's
 * language. Undefined for a persona with no journey.
 */
export function demoJourneyView(
  persona: DemoPersonaKey,
  t: Translator,
): DemoJourneyView | undefined {
  const entry = (
    Object.entries(demoJourneys) as [DemoJourneyKey, DemoJourney][]
  ).find(([, journey]) => journey.persona === persona);
  if (!entry) return undefined;
  const [key, journey] = entry;
  const copy = demoJourneyCopy[key];
  const steps: Readonly<Record<string, DemoJourneyStepCopy | undefined>> =
    copy.steps;
  return {
    title: t(copy.title),
    steps: journey.steps.flatMap(({ route }) => {
      const step = steps[route];
      return step ? [{ route, intent: t(step.message, step.values) }] : [];
    }),
  };
}

/**
 * The catalog states each persona's start route in audience-prefixed form for
 * journey fixtures. These are the deployed routes those journeys open.
 */
export const demoPersonaStartRoutes = {
  billingUser: "/billing",
  directBuyer: "/dashboard",
  distributor: "/partner/portfolio",
  endClient: "/services",
  financeApprover: "/internal/approvals",
  internalOperator: "/internal/queues",
  legalApprover: "/internal/approvals",
  referralPartner: "/partner/registrations",
  reseller: "/partner",
} as const satisfies Record<DemoPersonaKey, `/${string}`>;

export function demoPersonaStartRoute(
  persona: DemoPersonaKey,
): (typeof demoPersonaStartRoutes)[DemoPersonaKey] {
  return demoPersonaStartRoutes[persona];
}

export function demoPersonaAudience(persona: DemoPersona): ExperienceAudience {
  if (persona.isInternalStaff) return "internal";
  if (persona.role === "partner_admin" || persona.role === "partner_seller")
    return "partner";
  return "customer";
}

const staffOrganizationName = "Fil One Commerce Operations";

export function demoPersonaAccountName(persona: DemoPersona): string {
  return (
    pristineDemoSeed.accounts.find(
      (account) => account.id === persona.selectedAccountId,
    )?.name ?? staffOrganizationName
  );
}

export function demoPersonaOrganizationName(persona: DemoPersona): string {
  return persona.isInternalStaff
    ? staffOrganizationName
    : demoPersonaAccountName(persona);
}

export function demoPersonaMembership(
  persona: DemoPersona,
): AuthorizedMembership {
  const audience = demoPersonaAudience(persona);
  return {
    userId: persona.userId,
    userName: persona.displayName,
    userEmail: persona.email,
    isInternalStaff: persona.isInternalStaff,
    organizationId: persona.organizationId,
    workosOrganizationId: `org_demo_${persona.key}`,
    organizationName: demoPersonaOrganizationName(persona),
    accountId: persona.selectedAccountId,
    accountName: demoPersonaAccountName(persona),
    role: persona.role,
    audience,
    home:
      audience === "partner"
        ? "/partner"
        : audience === "internal"
          ? "/internal"
          : "/dashboard",
  };
}
