"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import {
  HubSpotHandoffInputSchema,
  accountDocumentKinds,
  countHubSpotPlan,
  defaultHubSpotDecision,
  classifyHubSpotDrift,
  hubspotPartnerFields,
  hubspotPlanIsLinkOnly,
  partnerModels,
  partnerStatuses,
  type AccountDocumentKind,
  type HubSpotFieldDecision,
  type HubSpotFieldHistory,
  type HubSpotHandoffPlan,
  type HubSpotPartnerField,
  type PartnerModel,
  type PartnerOwnerOption,
  type PartnerRecord,
  type PartnerStatus,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  Fieldset,
  InlineNotice,
  Input,
  Select,
  StatusBadge,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import { useUnsavedChangesWarning } from "@/src/features/customer-partner/unsaved-changes";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import {
  partnerHref,
  partnerModelLabels,
  partnerStatusLabels,
} from "../partners/model";
import { commitHubSpotHandoff } from "./actions";
import {
  driftLabels,
  formatHubSpotAmount,
  formatHubSpotDate,
  handoffHref,
  hubspotErrorMessage,
  hubspotPickerPath,
  receiptHref,
  type HandoffSource,
} from "./model";
import type { OwnerProposal } from "./page-data";
import { buildHubSpotPlan } from "./plan";
import styles from "./hubspot.module.css";

const fieldLabels: Readonly<Record<HubSpotPartnerField, MessageId>> = {
  name: "operations.partners.field.name",
  website: "operations.partners.field.website",
  region: "operations.partners.field.region",
};

const documentKindLabels: Readonly<Record<AccountDocumentKind, MessageId>> = {
  mnda: "operations.accountDocuments.kind.mnda",
  agreement: "operations.accountDocuments.kind.agreement",
  other: "operations.accountDocuments.kind.other",
};

interface Suggestion {
  id: string;
  name: string;
  website: string;
  reason: "name" | "website";
  linkedCompanyId: string | null;
}

interface ContactChoice {
  selected: boolean;
  /** "new", an existing contact ID, or "" while the person has not chosen. */
  match: string;
}

interface DocumentChoice {
  selected: boolean;
  title: string;
  kind: AccountDocumentKind;
}

function bytes(size: number | null, locale: string): string | null {
  if (size === null) return null;
  const units = ["byte", "kilobyte", "megabyte"] as const;
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(value);
}

/** The footer sentence, from the same plan the commit uses. */
function planSummary(
  plan: HubSpotHandoffPlan,
  t: Translator,
  locale: string,
  companyName: string,
): string {
  const counts = countHubSpotPlan(plan);
  const list = (parts: string[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(parts);
  const context = [
    counts.contactsAdded
      ? t("operations.hubspot.summary.contacts", {
          count: counts.contactsAdded,
        })
      : "",
    counts.contactsLinked
      ? t("operations.hubspot.summary.contactsLinked", {
          count: counts.contactsLinked,
        })
      : "",
    counts.deals
      ? t("operations.hubspot.summary.deals", { count: counts.deals })
      : "",
    counts.notes
      ? t("operations.hubspot.summary.notes", { count: counts.notes })
      : "",
    counts.references
      ? t("operations.hubspot.summary.references", { count: counts.references })
      : "",
    counts.documents
      ? t("operations.hubspot.summary.documents", { count: counts.documents })
      : "",
  ].filter(Boolean);
  if (counts.create)
    return context.length
      ? t("operations.hubspot.summary.create", {
          name: plan.destination.name,
          parts: list(context),
        })
      : t("operations.hubspot.summary.createOnly", {
          name: plan.destination.name,
        });
  if (hubspotPlanIsLinkOnly(plan))
    return t("operations.hubspot.summary.linkOnly", {
      company: companyName,
      partner: plan.destination.name,
    });
  const verb = (id: MessageId, count: number) =>
    count ? t(id, { count }) : "";
  const changes = [
    verb("operations.hubspot.summary.added", counts.added),
    verb("operations.hubspot.summary.replaced", counts.replaced),
    verb("operations.hubspot.summary.cleared", counts.cleared),
    verb("operations.hubspot.summary.addContacts", counts.contactsAdded),
    verb("operations.hubspot.summary.linkContacts", counts.contactsLinked),
    verb("operations.hubspot.summary.keepDeals", counts.deals),
    verb("operations.hubspot.summary.keepNotes", counts.notes),
    verb("operations.hubspot.summary.keepReferences", counts.references),
    verb("operations.hubspot.summary.attachDocuments", counts.documents),
  ].filter(Boolean);
  const kept = plan.fields.filter(
    (field) => field.action === "keep" && field.current !== "",
  ).length;
  const text = changes.length
    ? list(changes)
    : t("operations.hubspot.summary.noChanges");
  const sentence = kept
    ? t("operations.hubspot.summary.update", {
        changes: text,
        kept: t("operations.hubspot.summary.kept", { count: kept }),
      })
    : t("operations.hubspot.summary.updateOnly", { changes: text });
  // Staff copy is English: the sentence starts with a capital.
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function Endpoint({
  label,
  name,
  detail,
  link,
}: {
  label: string;
  name: string;
  detail?: ReactNode;
  link?: ReactNode;
}) {
  return (
    <div className={styles.endpoint}>
      <span className={styles.secondary}>{label}</span>
      <strong>{name}</strong>
      {detail}
      {link}
    </div>
  );
}

/**
 * One coherent handoff: the HubSpot source on the left, the Commerce partner
 * it becomes or updates on the right, and every group of information a
 * person may bring across. Nothing optional starts selected except the
 * originating deal as context. The footer states the plan's result in plain
 * words and the one action that commits it.
 */
export function HandoffReview({
  source,
  connection,
  destination,
  history,
  suggestions,
  owners,
  ownerProposal,
  linkedElsewhere,
  alreadyLinked = false,
  canImport,
  demo,
}: {
  source: HandoffSource;
  connection: { id: string; version: number };
  destination: PartnerRecord | null;
  history: HubSpotFieldHistory;
  suggestions: readonly Suggestion[];
  owners: readonly PartnerOwnerOption[];
  ownerProposal: OwnerProposal;
  linkedElsewhere: string | null;
  /** The company is already this partner's: a review with nothing chosen
   * has nothing to commit. */
  alreadyLinked?: boolean;
  canImport: boolean;
  demo: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const newPartnerId = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [changedItems, setChangedItems] = useState<string[] | null>(null);
  const [linkedFirst, setLinkedFirst] = useState<{
    partnerId: string;
    partnerName: string;
  } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Destination: a new partner's proposed details, or an update's decisions.
  const [name, setName] = useState(source.proposed.name);
  const [website, setWebsite] = useState(source.proposed.website);
  const [region, setRegion] = useState(source.proposed.region);
  const [status, setStatus] = useState<PartnerStatus>("prospect");
  const [ownerId, setOwnerId] = useState(
    ownerProposal.kind === "none" ? "" : ownerProposal.ownerId,
  );
  const [models, setModels] = useState<PartnerModel[]>([]);
  const [dismissed, setDismissed] = useState<
    Record<string, { open: boolean; reason: string; done: boolean }>
  >({});
  const drift = (field: HubSpotPartnerField) =>
    classifyHubSpotDrift({
      lastSource: history[field]?.lastSource,
      lastResult: history[field]?.lastResult,
      commerce: destination?.[field] ?? "",
      hubspot: source.proposed[field],
    });
  // What each field starts as. Region is never filled by default for a new
  // link: only name and website are default mappings.
  const startingDecision = (
    field: HubSpotPartnerField,
  ): HubSpotFieldDecision | null => {
    if (!destination) return "keep";
    const fieldDrift = drift(field);
    if (field === "region" && fieldDrift === "never_imported") return "keep";
    return defaultHubSpotDecision({
      drift: fieldDrift,
      commerce: destination[field],
      hubspot: source.proposed[field],
    });
  };
  const comparison = hubspotPartnerFields
    .map((field) =>
      [
        field,
        drift(field),
        destination?.[field] ?? "",
        source.proposed[field],
      ].join("\u0000"),
    )
    .join("\u0001");
  const [decisions, setDecisions] = useState<
    Record<HubSpotPartnerField, HubSpotFieldDecision | null>
  >(
    () =>
      Object.fromEntries(
        hubspotPartnerFields.map((field) => [field, startingDecision(field)]),
      ) as Record<HubSpotPartnerField, HubSpotFieldDecision | null>,
  );
  // After a refresh (HubSpot or the partner changed underneath the review),
  // a field whose comparison moved starts over: one that is now changed on
  // both sides needs a fresh choice, so a colleague's edit is never
  // overwritten by a choice made against the earlier values.
  const seenComparison = useRef(comparison);
  const seenFields = useRef(
    Object.fromEntries(
      hubspotPartnerFields.map((field) => [
        field,
        [drift(field), destination?.[field] ?? "", source.proposed[field]].join(
          "\u0000",
        ),
      ]),
    ) as Record<HubSpotPartnerField, string>,
  );
  const seenDestination = useRef(destination?.id ?? null);
  useEffect(() => {
    if (seenComparison.current === comparison) return;
    seenComparison.current = comparison;
    const destinationChanged =
      seenDestination.current !== (destination?.id ?? null);
    seenDestination.current = destination?.id ?? null;
    setDecisions((current) => {
      const next = { ...current };
      for (const field of hubspotPartnerFields) {
        const key = [
          drift(field),
          destination?.[field] ?? "",
          source.proposed[field],
        ].join("\u0000");
        if (destinationChanged || seenFields.current[field] !== key)
          next[field] = startingDecision(field);
        seenFields.current[field] = key;
      }
      return next;
    });
    if (destinationChanged) {
      setSubmitted(false);
      setLinkedFirst(null);
    }
    // `comparison` captures everything the decisions depend on.
  }, [comparison]);

  // Groups: nothing optional starts selected; the deal is kept as context.
  const [contacts, setContacts] = useState<Record<string, ContactChoice>>({});
  const [primary, setPrimary] = useState("");
  const [includeDeal, setIncludeDeal] = useState(source.deal !== null);
  const [endCustomer, setEndCustomer] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Record<string, DocumentChoice>>(
    {},
  );

  useUnsavedChangesWarning(dirty && !submitted);
  const touch = () => setDirty(true);

  const existingContacts = destination?.contacts ?? [];
  const linkedContact = (hubspotId: string) =>
    existingContacts.find(
      (contact) =>
        contact.source?.portalId === source.portal.portalId &&
        contact.source.objectId === hubspotId,
    );
  const emailMatch = (email: string) =>
    email
      ? existingContacts.find(
          (contact) => contact.id && !contact.source && contact.email === email,
        )
      : undefined;

  const rawInput = () => {
    operationId.current ??= crypto.randomUUID();
    newPartnerId.current ??= crypto.randomUUID();
    const selectedContacts = Object.entries(contacts).filter(
      ([, choice]) => choice.selected,
    );
    return {
      operationId: operationId.current,
      connection,
      source: {
        companyId: source.company.id,
        dealId: source.deal?.reference.id ?? null,
      },
      reviewed: source.digests,
      destination: destination
        ? {
            kind: "existing_partner",
            partnerId: destination.id,
            expectedVersion: destination.version,
            // Every decided field, explicitly; an undecided one is left
            // out so the server refuses it instead of reading it as "keep".
            fields: Object.fromEntries(
              hubspotPartnerFields.flatMap((field) => {
                const decision = decisions[field];
                return decision ? [[field, decision]] : [];
              }),
            ),
          }
        : {
            kind: "new_partner",
            partnerId: newPartnerId.current,
            name,
            website,
            region,
            status,
            ownerId,
            models,
            dismissedSuggestions: suggestions
              .filter((suggestion) => dismissed[suggestion.id]?.done)
              .map((suggestion) => ({
                partnerId: suggestion.id,
                reason: dismissed[suggestion.id]?.reason ?? "",
              })),
          },
      contacts: selectedContacts.map(([hubspotId, choice]) => ({
        hubspotId,
        matchContactId:
          choice.match && choice.match !== "new" ? choice.match : null,
      })),
      primaryContact: primary.startsWith("hubspot:")
        ? { kind: "hubspot", id: primary.slice(8) }
        : primary.startsWith("commerce:")
          ? { kind: "commerce", id: primary.slice(9) }
          : null,
      includeDeal,
      endCustomerCompanyId: includeDeal && endCustomer ? endCustomer : null,
      notes,
      referenceProperties: references.map((key) => {
        const [objectType, property] = key.split(":");
        return { objectType, name: property };
      }),
      documents: Object.entries(documents)
        .filter(([, choice]) => choice.selected)
        .map(([fileId, choice]) => ({
          fileId,
          title: choice.title,
          kind: choice.kind,
        })),
    };
  };

  // The plan the footer describes is the plan the server will build.
  const preview = useMemo(() => {
    const parsed = HubSpotHandoffInputSchema.safeParse(rawInput());
    if (!parsed.success) return null;
    try {
      return buildHubSpotPlan({
        source,
        handoff: parsed.data,
        destination,
        history,
        ownerName: owners.find((owner) => owner.id === ownerId)?.name ?? null,
        newId: () => "00000000-0000-4000-8000-000000000000",
      }).plan;
    } catch {
      return null;
    }
    // rawInput reads the state listed here.
  }, [
    name,
    website,
    region,
    status,
    ownerId,
    models,
    dismissed,
    decisions,
    contacts,
    primary,
    includeDeal,
    endCustomer,
    notes,
    references,
    documents,
    source,
    destination,
  ]);

  // Everything that must be decided before the commit, each linked to its field.
  const issues: { id: string; label: string }[] = [];
  if (!destination && !name.trim())
    issues.push({
      id: "handoff-name",
      label: t("operations.hubspot.issue.name"),
    });
  if (destination)
    for (const field of hubspotPartnerFields)
      if (decisions[field] === null)
        issues.push({
          id: `decision-${field}`,
          label: t("operations.hubspot.issue.decision", {
            field: t(fieldLabels[field]),
          }),
        });
  if (!destination)
    for (const suggestion of suggestions)
      if (!dismissed[suggestion.id]?.done)
        issues.push({
          id: `suggestion-${suggestion.id}`,
          label: t("operations.hubspot.issue.suggestion", {
            name: suggestion.name,
          }),
        });
  for (const [hubspotId, choice] of Object.entries(contacts)) {
    const person = source.contacts.find((c) => c.id === hubspotId);
    if (
      choice.selected &&
      person &&
      !linkedContact(person.id) &&
      emailMatch(person.email) &&
      !choice.match
    )
      issues.push({
        id: `contact-match-${hubspotId}`,
        label: t("operations.hubspot.issue.contactMatch", {
          name: person.name,
        }),
      });
  }
  for (const [fileId, choice] of Object.entries(documents))
    if (choice.selected && !choice.title.trim())
      issues.push({
        id: `document-title-${fileId}`,
        label: t("operations.hubspot.issue.documentTitle"),
      });

  const linkOnly = preview ? hubspotPlanIsLinkOnly(preview) : false;
  const nothingToDo = alreadyLinked && linkOnly;
  const primaryLabel = !destination
    ? t("operations.hubspot.action.create")
    : linkOnly && !alreadyLinked
      ? t("operations.hubspot.action.link")
      : t("operations.hubspot.action.import");
  const blocked = Boolean(linkedElsewhere) || !canImport || nothingToDo;
  const advancedInEffect = [
    references.length
      ? t("operations.hubspot.more.references", { count: references.length })
      : "",
    hubspotPartnerFields.some((field) => decisions[field] === "clear")
      ? t("operations.hubspot.more.clears")
      : "",
  ].filter(Boolean);

  function submit() {
    setShowErrors(true);
    setFailure(null);
    setLinkedFirst(null);
    if (issues.length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    startTransition(async () => {
      const result = await commitHubSpotHandoff(rawInput()).catch(() => ({
        ok: false as const,
        code: "UNEXPECTED",
      }));
      if (!result.ok) {
        setFailure(result.code);
        // Someone changed the partner: load their change and keep every
        // choice, so the comparison shows it and asks again where needed.
        if (result.code === "PARTNER_VERSION_CONFLICT") router.refresh();
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      const value = result.value;
      if (value.kind === "source_changed") {
        // Fresh source, same selections: the page reloads its data only.
        setChangedItems(value.items);
        router.refresh();
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      if (value.kind === "already_linked") {
        setLinkedFirst(value);
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      setSubmitted(true);
      router.push(
        receiptHref(value.partnerId, value.importId, {
          start: value.pendingDocuments > 0,
        }),
      );
    });
  }

  const changedLabel = (key: string) => {
    if (key === "company") return t("operations.hubspot.group.company");
    if (key === "deal") return t("operations.hubspot.group.context");
    const [kind, id] = key.split(":");
    if (kind === "contact")
      return source.contacts.find((c) => c.id === id)?.name ?? key;
    if (kind === "note") return t("operations.hubspot.group.notes");
    return source.files?.find((file) => file.id === id)?.name ?? key;
  };

  const deal = source.deal?.reference ?? null;
  const ownerReason = (() => {
    const proposedId =
      ownerProposal.kind === "none" ? "" : ownerProposal.ownerId;
    if (ownerId !== proposedId) return t("operations.hubspot.owner.chosen");
    if (ownerProposal.kind === "mapped")
      return t("operations.hubspot.owner.mapped", {
        name: ownerProposal.hubspotOwner,
      });
    if (ownerProposal.kind === "viewer")
      return ownerProposal.hubspotOwner
        ? t("operations.hubspot.owner.viewerUnmapped", {
            name: ownerProposal.hubspotOwner,
          })
        : t("operations.hubspot.owner.viewerNoOwner");
    return ownerProposal.hubspotOwner
      ? t("operations.hubspot.owner.noneUnmapped", {
          name: ownerProposal.hubspotOwner,
        })
      : t("operations.hubspot.owner.none");
  })();

  const referenceOptions = [
    ...source.companyValues,
    ...(source.deal?.values ?? []),
  ];

  return (
    <div className={styles.form}>
      <div className={styles.handoff}>
        <Endpoint
          label={t("operations.hubspot.review.from")}
          name={source.company.name}
          detail={
            <span className={styles.source}>
              {deal
                ? t("operations.hubspot.review.fromDeal", { deal: deal.name })
                : t("operations.hubspot.review.fromCompany")}
            </span>
          }
          link={
            <a
              href={source.company.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("operations.hubspot.openInHubSpot")}
            </a>
          }
        />
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <Endpoint
          label={
            destination
              ? t("operations.hubspot.review.toExisting")
              : t("operations.hubspot.review.toNew")
          }
          name={destination?.name ?? (name || source.company.name)}
          detail={
            <span className={styles.secondary}>
              {t("operations.hubspot.review.storedOn")}
            </span>
          }
          link={
            destination ? (
              <Link
                href={partnerHref(destination.id)}
                target="_blank"
                rel="noopener"
              >
                {t("operations.hubspot.openPartner")}
              </Link>
            ) : undefined
          }
        />
      </div>

      <span className={styles.secondary}>
        {t("operations.hubspot.review.read")}{" "}
        <LocalTimestamp value={source.retrievedAt} locale={locale} />
      </span>

      {demo ? (
        <InlineNotice tone="info" title={t("operations.hubspot.demo")} />
      ) : !canImport ? (
        <InlineNotice tone="info" title={t("operations.hubspot.readOnly")} />
      ) : null}
      {linkedElsewhere ? (
        <InlineNotice
          tone="warning"
          title={t("operations.hubspot.review.linkedElsewhereTitle")}
          description={t("operations.hubspot.review.linkedElsewhereBody", {
            company: linkedElsewhere,
          })}
        />
      ) : null}

      <div ref={summaryRef} tabIndex={-1} className={styles.receipt}>
        {changedItems ? (
          <InlineNotice
            tone="warning"
            live="polite"
            title={t("operations.hubspot.review.changedTitle")}
            description={t("operations.hubspot.review.changedBody", {
              items: new Intl.ListFormat(locale, {
                type: "conjunction",
              }).format(changedItems.map(changedLabel)),
            })}
          />
        ) : null}
        {linkedFirst ? (
          <InlineNotice
            tone="info"
            live="polite"
            title={t("operations.hubspot.review.alreadyLinkedTitle", {
              name: linkedFirst.partnerName,
            })}
            description={t("operations.hubspot.review.alreadyLinkedBody")}
            action={
              <span className={styles.actions}>
                <Link
                  className={buttonClassName({ variant: "secondary" })}
                  href={partnerHref(linkedFirst.partnerId)}
                >
                  {t("operations.hubspot.openPartner")}
                </Link>
                <Link
                  className={buttonClassName({ variant: "quiet" })}
                  href={handoffHref({
                    company: source.company.id,
                    deal: deal?.id ?? null,
                  })}
                  onClick={() => setSubmitted(true)}
                >
                  {t("operations.hubspot.reviewUpdates")}
                </Link>
              </span>
            }
          />
        ) : null}
        {failure ? (
          <InlineNotice
            tone="danger"
            live="assertive"
            title={t(hubspotErrorMessage(failure))}
          />
        ) : null}
        {showErrors && issues.length ? (
          <section className="cw-validation-summary" role="alert">
            <h2>
              {t("operations.hubspot.issue.title", { count: issues.length })}
            </h2>
            <ul>
              {issues.map((issue) => (
                <li key={issue.id}>
                  <a href={`#${issue.id}`}>{issue.label}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {destination ? (
        <section className={styles.card} aria-labelledby="handoff-compare">
          <h2 id="handoff-compare">{t("operations.hubspot.compare.title")}</h2>
          <p className={styles.muted}>{t("operations.hubspot.compare.body")}</p>
          <table className={styles.compare}>
            <caption className="cw-sr-only">
              {t("operations.hubspot.compare.title")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("operations.hubspot.compare.field")}</th>
                <th scope="col">{t("operations.hubspot.compare.commerce")}</th>
                <th scope="col">{t("operations.hubspot.compare.hubspot")}</th>
                <th scope="col">{t("operations.hubspot.compare.decision")}</th>
              </tr>
            </thead>
            <tbody>
              {hubspotPartnerFields.map((field) => {
                const current = destination[field];
                const hubspot = source.proposed[field];
                const fieldDrift = drift(field);
                const decision = decisions[field];
                const options: HubSpotFieldDecision[] = [
                  "keep",
                  "use_hubspot",
                  ...(field !== "name" && current ? (["clear"] as const) : []),
                ];
                return (
                  <tr key={field}>
                    <th scope="row">
                      <span className={styles.rowHeading}>
                        {t(fieldLabels[field])}
                        {fieldDrift !== "never_imported" &&
                        fieldDrift !== "unchanged" ? (
                          <StatusBadge
                            tone={
                              fieldDrift === "both_changed" ? "warning" : "info"
                            }
                          >
                            {t(driftLabels[fieldDrift])}
                          </StatusBadge>
                        ) : null}
                      </span>
                    </th>
                    <td data-label={t("operations.hubspot.compare.commerce")}>
                      {current || (
                        <span className={styles.secondary}>
                          {t("operations.hubspot.notSet")}
                        </span>
                      )}
                    </td>
                    <td data-label={t("operations.hubspot.compare.hubspot")}>
                      {hubspot || (
                        <span className={styles.secondary}>
                          {t("operations.hubspot.notSet")}
                        </span>
                      )}
                    </td>
                    <td data-label={t("operations.hubspot.compare.decision")}>
                      <fieldset
                        className={styles.decision}
                        id={`decision-${field}`}
                      >
                        <legend className="cw-sr-only">
                          {t("operations.hubspot.compare.decisionFor", {
                            field: t(fieldLabels[field]),
                          })}
                        </legend>
                        {options.map((option) => (
                          <label key={option}>
                            <input
                              type="radio"
                              name={`decision-${field}`}
                              value={option}
                              checked={decision === option}
                              disabled={
                                option === "use_hubspot" &&
                                (!hubspot || hubspot === current)
                              }
                              onChange={() => {
                                touch();
                                setDecisions((all) => ({
                                  ...all,
                                  [field]: option,
                                }));
                              }}
                            />
                            {t(
                              option === "keep"
                                ? "operations.hubspot.decision.keep"
                                : option === "use_hubspot"
                                  ? "operations.hubspot.decision.use"
                                  : "operations.hubspot.decision.clear",
                            )}
                          </label>
                        ))}
                      </fieldset>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.secondary}>
            {t("operations.hubspot.compare.unchanged")}
          </p>
        </section>
      ) : (
        <section className={styles.card} aria-labelledby="handoff-partner">
          <h2 id="handoff-partner">{t("operations.hubspot.group.company")}</h2>
          {suggestions.length ? (
            <InlineNotice
              tone="warning"
              title={t("operations.hubspot.suggestion.title")}
              description={t("operations.hubspot.suggestion.body")}
            />
          ) : null}
          {suggestions.length ? (
            <ul className={styles.choices}>
              {suggestions.map((suggestion) => {
                const state = dismissed[suggestion.id] ?? {
                  open: false,
                  reason: "",
                  done: false,
                };
                const set = (patch: Partial<typeof state>) => {
                  touch();
                  setDismissed((all) => ({
                    ...all,
                    [suggestion.id]: { ...state, ...patch },
                  }));
                };
                return (
                  <li
                    className={styles.choice}
                    key={suggestion.id}
                    id={`suggestion-${suggestion.id}`}
                    tabIndex={-1}
                  >
                    <div className={styles.rowHeading}>
                      <h3>{suggestion.name}</h3>
                      <Tag>
                        {t(
                          suggestion.reason === "name"
                            ? "operations.hubspot.suggestion.sameName"
                            : "operations.hubspot.suggestion.sameWebsite",
                        )}
                      </Tag>
                      {state.done ? (
                        <StatusBadge tone="neutral">
                          {t("operations.hubspot.suggestion.dismissed")}
                        </StatusBadge>
                      ) : null}
                    </div>
                    {suggestion.website ? (
                      <span className={styles.secondary}>
                        {suggestion.website}
                      </span>
                    ) : null}
                    {suggestion.linkedCompanyId ? (
                      <span className={styles.secondary}>
                        {t("operations.hubspot.suggestion.linkedOther")}
                      </span>
                    ) : null}
                    <div className={styles.actions}>
                      <Link
                        className={buttonClassName({ variant: "quiet" })}
                        href={partnerHref(suggestion.id)}
                        target="_blank"
                      >
                        {t("operations.hubspot.suggestion.inspect")}
                      </Link>
                      {suggestion.linkedCompanyId ? null : (
                        <Link
                          className={buttonClassName({ variant: "secondary" })}
                          href={handoffHref({
                            company: source.company.id,
                            deal: deal?.id ?? null,
                            partner: suggestion.id,
                          })}
                          onClick={() => setSubmitted(true)}
                        >
                          {t("operations.hubspot.suggestion.useThis")}
                        </Link>
                      )}
                      {state.done ? (
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => set({ done: false, open: true })}
                        >
                          {t("operations.hubspot.suggestion.undo")}
                        </Button>
                      ) : state.open ? null : (
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => set({ open: true })}
                        >
                          {t("operations.hubspot.suggestion.notSame")}
                        </Button>
                      )}
                    </div>
                    {state.open && !state.done ? (
                      <div className={styles.fields}>
                        <Input
                          label={t("operations.hubspot.suggestion.reason")}
                          help={t("operations.hubspot.suggestion.reasonHelp")}
                          value={state.reason}
                          maxLength={300}
                          onChange={(event) =>
                            set({ reason: event.currentTarget.value })
                          }
                        />
                        <div className={styles.actions}>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={!state.reason.trim()}
                            onClick={() => set({ done: true, open: false })}
                          >
                            {t("operations.hubspot.suggestion.confirm")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className={styles.fields}>
            <Input
              id="handoff-name"
              label={t("operations.partners.field.name")}
              value={name}
              maxLength={200}
              required
              onChange={(event) => {
                touch();
                setName(event.currentTarget.value);
              }}
              help={
                name.trim() !== source.proposed.name
                  ? t("operations.hubspot.inHubSpot", {
                      value:
                        source.proposed.name || t("operations.hubspot.notSet"),
                    })
                  : undefined
              }
              error={
                showErrors && !name.trim()
                  ? t("operations.hubspot.issue.name")
                  : undefined
              }
            />
            <Input
              label={t("operations.partners.field.website")}
              optionalLabel={t("operations.partners.field.optional")}
              value={website}
              maxLength={500}
              onChange={(event) => {
                touch();
                setWebsite(event.currentTarget.value);
              }}
              help={
                website.trim() !== source.proposed.website
                  ? t("operations.hubspot.inHubSpot", {
                      value:
                        source.proposed.website ||
                        t("operations.hubspot.notSet"),
                    })
                  : undefined
              }
            />
            <Input
              label={t("operations.partners.field.region")}
              optionalLabel={t("operations.partners.field.optional")}
              value={region}
              maxLength={500}
              onChange={(event) => {
                touch();
                setRegion(event.currentTarget.value);
              }}
              help={
                region.trim() !== source.proposed.region
                  ? t("operations.hubspot.inHubSpot", {
                      value:
                        source.proposed.region ||
                        t("operations.hubspot.notSet"),
                    })
                  : undefined
              }
            />
            <Select
              label={t("operations.hubspot.status.label")}
              value={status}
              onChange={(event) => {
                touch();
                setStatus(event.currentTarget.value as PartnerStatus);
              }}
              help={
                deal?.stage.label
                  ? t("operations.hubspot.status.helpStage", {
                      stage: deal.stage.label,
                    })
                  : t("operations.hubspot.status.help")
              }
              options={partnerStatuses.map((value) => ({
                value,
                label: t(partnerStatusLabels[value]),
              }))}
            />
            <Select
              label={t("operations.partners.field.owner")}
              value={ownerId}
              help={ownerReason}
              onChange={(event) => {
                touch();
                setOwnerId(event.currentTarget.value);
              }}
              options={[
                { value: "", label: t("operations.partners.unowned") },
                ...owners.map((owner) => ({
                  value: owner.id,
                  label: owner.name,
                })),
              ]}
            />
            <fieldset className={`${styles.decision} ${styles.wide}`}>
              <legend className={styles.secondary}>
                {t("operations.hubspot.models")}
              </legend>
              {partnerModels.map((model) => (
                <label key={model}>
                  <input
                    type="checkbox"
                    checked={models.includes(model)}
                    onChange={(event) => {
                      touch();
                      const checked = event.currentTarget.checked;
                      setModels((all) =>
                        checked
                          ? [...all, model]
                          : all.filter((value) => value !== model),
                      );
                    }}
                  />
                  {t(partnerModelLabels[model])}
                </label>
              ))}
            </fieldset>
          </div>
        </section>
      )}

      <Fieldset
        legend={t("operations.hubspot.group.people")}
        description={t("operations.hubspot.people.body")}
        className={styles.card}
      >
        {source.contacts.length ? (
          <ul className={styles.choices}>
            {source.contacts.map((person) => {
              const choice = contacts[person.id] ?? {
                selected: false,
                match: "",
              };
              const linked = linkedContact(person.id);
              const match = linked ? undefined : emailMatch(person.email);
              const set = (patch: Partial<ContactChoice>) => {
                touch();
                setContacts((all) => ({
                  ...all,
                  [person.id]: { ...choice, ...patch },
                }));
              };
              return (
                <li
                  className={styles.choice}
                  key={person.id}
                  id={`contact-${person.id}`}
                  {...(choice.selected ? { "data-selected": "" } : {})}
                >
                  <Checkbox
                    label={person.name}
                    checked={choice.selected}
                    onChange={(event) => {
                      const selected = event.currentTarget.checked;
                      set({ selected });
                      if (!selected && primary === `hubspot:${person.id}`)
                        setPrimary("");
                    }}
                    description={
                      [
                        person.role,
                        person.email,
                        person.labels.length
                          ? t("operations.hubspot.people.labels", {
                              labels: person.labels.join(", "),
                            })
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  />
                  {linked ? (
                    <span
                      className={`${styles.secondary} ${styles.choiceDetail}`}
                    >
                      {t("operations.hubspot.people.alreadyLinked", {
                        name: linked.name,
                      })}
                    </span>
                  ) : null}
                  {match && choice.selected ? (
                    <div className={styles.choiceDetail}>
                      <Select
                        label={t("operations.hubspot.people.matchLabel", {
                          name: match.name,
                        })}
                        value={choice.match}
                        id={`contact-match-${person.id}`}
                        onChange={(event) => {
                          const match = event.currentTarget.value;
                          set({ match });
                          if (
                            match !== "new" &&
                            primary === `hubspot:${person.id}`
                          )
                            setPrimary("");
                        }}
                        error={
                          showErrors && !choice.match
                            ? t("operations.hubspot.issue.contactMatch", {
                                name: person.name,
                              })
                            : undefined
                        }
                        options={[
                          {
                            value: "",
                            label: t("operations.hubspot.people.matchChoose"),
                          },
                          {
                            value: match.id ?? "",
                            label: t("operations.hubspot.people.matchSame", {
                              name: match.name,
                            }),
                          },
                          {
                            value: "new",
                            label: t("operations.hubspot.people.matchNew"),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.muted}>{t("operations.hubspot.people.none")}</p>
        )}
        {source.contacts.length || existingContacts.length ? (
          <Select
            label={t("operations.hubspot.people.primary")}
            help={t("operations.hubspot.people.primaryHelp")}
            value={primary}
            onChange={(event) => {
              touch();
              setPrimary(event.currentTarget.value);
            }}
            options={[
              {
                value: "",
                label: t("operations.hubspot.people.primaryUnchanged"),
              },
              // A person already on the partner, or confirmed as the same
              // person as a Commerce contact, is offered once, as that
              // Commerce contact; only people who will be added appear by
              // their HubSpot entry.
              ...source.contacts
                .filter((person) => {
                  const choice = contacts[person.id];
                  return (
                    choice?.selected &&
                    !linkedContact(person.id) &&
                    (!choice.match || choice.match === "new")
                  );
                })
                .map((person) => ({
                  value: `hubspot:${person.id}`,
                  label: person.name,
                })),
              ...existingContacts
                .filter((contact) => contact.id)
                .map((contact) => ({
                  value: `commerce:${contact.id ?? ""}`,
                  label: t("operations.hubspot.people.existing", {
                    name: contact.name,
                  }),
                })),
            ]}
          />
        ) : null}
      </Fieldset>

      <Fieldset
        legend={t("operations.hubspot.group.context")}
        description={t("operations.hubspot.context.body")}
        className={styles.card}
      >
        {deal ? (
          <div
            className={styles.choice}
            {...(includeDeal ? { "data-selected": "" } : {})}
          >
            <Checkbox
              label={t("operations.hubspot.context.keepDeal", {
                name: deal.name,
              })}
              checked={includeDeal}
              onChange={(event) => {
                touch();
                setIncludeDeal(event.currentTarget.checked);
                if (!event.currentTarget.checked) setEndCustomer("");
              }}
              description={t("operations.hubspot.context.keepDealHelp")}
            />
            <dl className={`${styles.facts} ${styles.choiceDetail}`}>
              <dt>{t("operations.hubspot.deal.stage")}</dt>
              <dd>
                {[deal.pipeline.label, deal.stage.label]
                  .filter(Boolean)
                  .join(" · ") || t("operations.hubspot.notSet")}
              </dd>
              <dt>{t("operations.hubspot.deal.amount")}</dt>
              <dd>
                {deal.amount && deal.currency
                  ? formatHubSpotAmount(deal.amount, deal.currency, locale)
                  : deal.amount
                    ? t("operations.hubspot.deal.amountNoCurrency", {
                        amount: deal.amount,
                      })
                    : t("operations.hubspot.notSet")}
              </dd>
              <dt>{t("operations.hubspot.deal.close")}</dt>
              <dd>
                {formatHubSpotDate(deal.closeDate, locale) ??
                  t("operations.hubspot.notSet")}
              </dd>
              <dt>{t("operations.hubspot.deal.owner")}</dt>
              <dd>
                {deal.owner?.name ??
                  deal.owner?.id ??
                  t("operations.hubspot.noOwner")}
              </dd>
              <dt>{t("operations.hubspot.deal.companies")}</dt>
              <dd>
                <ul className={styles.list}>
                  {deal.associatedCompanies.map((company) => (
                    <li key={company.id}>
                      <span>
                        {company.name}
                        {company.id === source.company.id
                          ? ` · ${t("operations.hubspot.deal.becomesPartner")}`
                          : ""}
                      </span>
                      {company.labels.length ? (
                        <span className={styles.tags}>
                          {company.labels.map((label) => (
                            <Tag key={label}>{label}</Tag>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
            {includeDeal &&
            deal.associatedCompanies.some((c) => c.id !== source.company.id) ? (
              <div className={styles.choiceDetail}>
                <Select
                  label={t("operations.hubspot.context.endCustomer")}
                  help={t("operations.hubspot.context.endCustomerHelp")}
                  optionalLabel={t("operations.partners.field.optional")}
                  value={endCustomer}
                  onChange={(event) => {
                    touch();
                    setEndCustomer(event.currentTarget.value);
                  }}
                  options={[
                    {
                      value: "",
                      label: t("operations.hubspot.context.endCustomerNone"),
                    },
                    ...deal.associatedCompanies
                      .filter((company) => company.id !== source.company.id)
                      .map((company) => ({
                        value: company.id,
                        label: company.labels.length
                          ? `${company.name} (${company.labels.join(", ")})`
                          : company.name,
                      })),
                  ]}
                />
              </div>
            ) : null}
            <p className={`${styles.secondary} ${styles.choiceDetail}`}>
              {t("operations.hubspot.context.notRegistration")}
            </p>
          </div>
        ) : (
          <p className={styles.muted}>
            {t("operations.hubspot.context.noDeal")}
          </p>
        )}
        <h3>{t("operations.hubspot.group.notes")}</h3>
        {source.notes === null ? (
          <p className={styles.muted}>
            {t("operations.hubspot.notes.outOfScope")}
          </p>
        ) : source.notes.length ? (
          <ul className={styles.choices}>
            {source.notes.map((note) => (
              <li
                className={styles.choice}
                key={note.id}
                {...(notes.includes(note.id) ? { "data-selected": "" } : {})}
              >
                <Checkbox
                  label={t("operations.hubspot.notes.label", {
                    author:
                      note.authorName ??
                      t("operations.hubspot.notes.unknownAuthor"),
                    date:
                      formatHubSpotDate(note.timestamp, locale) ??
                      t("operations.hubspot.notSet"),
                  })}
                  checked={notes.includes(note.id)}
                  onChange={(event) => {
                    touch();
                    const checked = event.currentTarget.checked;
                    setNotes((all) =>
                      checked
                        ? [...all, note.id]
                        : all.filter((id) => id !== note.id),
                    );
                  }}
                />
                <details className={styles.choiceDetail}>
                  <summary>{t("operations.hubspot.notes.preview")}</summary>
                  <p className={`${styles.prose} ${styles.secondary}`}>
                    {note.body || t("operations.hubspot.notes.empty")}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{t("operations.hubspot.notes.none")}</p>
        )}
      </Fieldset>

      <Fieldset
        legend={t("operations.hubspot.group.documents")}
        description={t("operations.hubspot.documents.body")}
        className={styles.card}
      >
        {source.files === null ? (
          <p className={styles.muted}>
            {t("operations.hubspot.documents.outOfScope")}
          </p>
        ) : source.files.length ? (
          <ul className={styles.choices}>
            {source.files.map((file) => {
              const choice = documents[file.id] ?? {
                selected: false,
                title: file.name.replace(/\.pdf$/i, "").slice(0, 200),
                kind: "other" as const,
              };
              const set = (patch: Partial<DocumentChoice>) => {
                touch();
                setDocuments((all) => ({
                  ...all,
                  [file.id]: { ...choice, ...patch },
                }));
              };
              const size = bytes(file.size, locale);
              const detail = [file.extension?.toUpperCase(), size]
                .filter(Boolean)
                .join(" · ");
              if (file.availability !== "available")
                return (
                  <li
                    className={`${styles.choice} ${styles.unavailable}`}
                    key={file.id}
                  >
                    <strong>{file.name}</strong>
                    <span className={styles.secondary}>
                      {[
                        detail,
                        t(
                          file.availability === "unsupported_type"
                            ? "operations.hubspot.documents.unsupported"
                            : file.availability === "too_large"
                              ? "operations.hubspot.documents.tooLarge"
                              : "operations.hubspot.documents.unreadable",
                        ),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                );
              return (
                <li
                  className={styles.choice}
                  key={file.id}
                  id={`document-${file.id}`}
                  {...(choice.selected ? { "data-selected": "" } : {})}
                >
                  <Checkbox
                    label={file.name}
                    checked={choice.selected}
                    onChange={(event) =>
                      set({ selected: event.currentTarget.checked })
                    }
                    description={detail || undefined}
                  />
                  {/\b(signed|executed|countersigned)\b/i.test(file.name) ? (
                    <span
                      className={`${styles.secondary} ${styles.choiceDetail}`}
                    >
                      {t("operations.hubspot.documents.claim")}
                    </span>
                  ) : null}
                  {choice.selected ? (
                    <div className={`${styles.fields} ${styles.choiceDetail}`}>
                      <Input
                        id={`document-title-${file.id}`}
                        label={t("operations.hubspot.documents.title")}
                        value={choice.title}
                        maxLength={200}
                        onChange={(event) =>
                          set({ title: event.currentTarget.value })
                        }
                        error={
                          showErrors && !choice.title.trim()
                            ? t("operations.hubspot.issue.documentTitle")
                            : undefined
                        }
                      />
                      <Select
                        label={t("operations.hubspot.documents.kind")}
                        value={choice.kind}
                        onChange={(event) =>
                          set({
                            kind: event.currentTarget
                              .value as AccountDocumentKind,
                          })
                        }
                        options={accountDocumentKinds.map((kind) => ({
                          value: kind,
                          label: t(documentKindLabels[kind]),
                        }))}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.muted}>
            {t("operations.hubspot.documents.none")}
          </p>
        )}
      </Fieldset>

      {/* Open or closed, every choice below stays as it was. */}
      <details className={styles.more}>
        <summary>
          {t("operations.hubspot.more.title")}
          {advancedInEffect.length ? (
            <span>
              {t("operations.hubspot.more.inEffect", {
                items: new Intl.ListFormat(locale, {
                  type: "conjunction",
                }).format(advancedInEffect),
              })}
            </span>
          ) : (
            <span>{t("operations.hubspot.more.hint")}</span>
          )}
        </summary>
        <div className={styles.moreBody}>
          <Fieldset
            legend={t("operations.hubspot.more.referencesTitle")}
            description={t("operations.hubspot.more.referencesBody")}
          >
            {referenceOptions.length ? (
              <ul className={styles.choices}>
                {referenceOptions.map((value) => {
                  const key = `${value.objectType}:${value.property}`;
                  return (
                    <li key={key}>
                      <Checkbox
                        label={t(
                          value.objectType === "company"
                            ? "operations.hubspot.more.companyProperty"
                            : "operations.hubspot.more.dealProperty",
                          { label: value.label },
                        )}
                        description={
                          value.value ?? t("operations.hubspot.notSet")
                        }
                        checked={references.includes(key)}
                        onChange={(event) => {
                          touch();
                          const checked = event.currentTarget.checked;
                          setReferences((all) =>
                            checked
                              ? [...all, key]
                              : all.filter((k) => k !== key),
                          );
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.muted}>
                {t("operations.hubspot.more.noProperties")}
              </p>
            )}
          </Fieldset>
          <p className={styles.secondary}>
            {t("operations.hubspot.more.neverImported")}
          </p>
          {destination ? (
            <p className={styles.secondary}>
              {t("operations.hubspot.more.clearHelp")}
            </p>
          ) : null}
        </div>
      </details>

      <p className={styles.secondary}>
        {t("operations.hubspot.audience")}{" "}
        {t("operations.hubspot.noSecondConfirmation")}
      </p>
      <footer className={styles.footer} aria-labelledby="handoff-summary">
        <p className={styles.summary} id="handoff-summary">
          {nothingToDo
            ? t("operations.hubspot.summary.nothingSelected")
            : preview
              ? planSummary(preview, t, locale, source.company.name)
              : t("operations.hubspot.summary.incomplete")}
        </p>
        <div className={styles.footerRow}>
          <div className={styles.actions}>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || blocked}
              aria-describedby="handoff-summary"
            >
              {pending ? t("operations.hubspot.action.working") : primaryLabel}
            </Button>
            {confirmingCancel ? (
              <span className={styles.actions} role="group">
                <span className={styles.secondary} role="alert">
                  {t("operations.hubspot.cancel.confirm")}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingCancel(false)}
                >
                  {t("operations.hubspot.cancel.keep")}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setSubmitted(true);
                    if (window.history.length > 1) router.back();
                    else router.push(hubspotPickerPath);
                  }}
                >
                  {t("operations.hubspot.cancel.discard")}
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  if (dirty) setConfirmingCancel(true);
                  else if (window.history.length > 1) router.back();
                  else router.push(hubspotPickerPath);
                }}
              >
                {t("operations.hubspot.cancel.label")}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
