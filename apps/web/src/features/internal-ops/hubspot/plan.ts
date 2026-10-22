import {
  classifyHubSpotDrift,
  contractPdfFileName,
  defaultHubSpotDecision,
  hubspotFieldAction,
  hubspotPartnerFieldSources,
  hubspotPartnerFields,
  type HubSpotFieldChange,
  type HubSpotFieldHistory,
  type HubSpotHandoffInput,
  type HubSpotHandoffPlan,
  type HubSpotPartnerField,
  type HubSpotPlannedContact,
  type HubSpotSourceSnapshot,
  type HubSpotSourceValue,
  type PartnerRecord,
} from "@clockwork/contracts";

import type { HandoffSource } from "./model";

export class HandoffPlanError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const refuse = (code: string): never => {
  throw new HandoffPlanError(code);
};

/** The HubSpot value each partner field would take, already normalized. */
export function proposedValue(
  source: Pick<HandoffSource, "proposed">,
  field: HubSpotPartnerField,
): string {
  return source.proposed[field];
}

function fieldSource(source: HandoffSource, field: HubSpotPartnerField) {
  const { property, label } = hubspotPartnerFieldSources[field];
  const raw =
    field === "name"
      ? source.company.name
      : field === "website"
        ? (source.company.website ?? (source.company.domain || null))
        : source.company.country;
  return {
    property:
      field === "website" && !source.company.website ? "domain" : property,
    label,
    value: raw || null,
  };
}

/**
 * Which reviewed items changed since the review was read: the company, the
 * deal when it is used, and every selected person, note and file. An item
 * the review never saw counts as changed.
 */
export function changedReviewItems(
  reviewed: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  input: Pick<
    HubSpotHandoffInput,
    "includeDeal" | "endCustomerCompanyId" | "contacts" | "notes" | "documents"
  > & { source: { dealId: string | null } },
): string[] {
  const keys = [
    "company",
    ...(input.source.dealId && (input.includeDeal || input.endCustomerCompanyId)
      ? ["deal"]
      : []),
    ...input.contacts.map((contact) => `contact:${contact.hubspotId}`),
    ...input.notes.map((id) => `note:${id}`),
    ...input.documents.map((document) => `file:${document.fileId}`),
  ];
  return keys.filter(
    (key) => !reviewed[key] || !current[key] || reviewed[key] !== current[key],
  );
}

/**
 * The plan a reviewed handoff commits, and the snapshot of what it read. It
 * refuses anything the source does not offer rather than dropping it: a
 * person, note, file or property that is not there, or outside the approved
 * scope, stops the commit with a code the review can explain.
 */
export function buildHubSpotPlan(input: {
  source: HandoffSource;
  handoff: HubSpotHandoffInput;
  /** The partner an update writes to; `null` for a new partner. */
  destination: PartnerRecord | null;
  history: HubSpotFieldHistory;
  ownerName: string | null;
  newId: () => string;
}): { plan: HubSpotHandoffPlan; snapshot: HubSpotSourceSnapshot } {
  const { source, handoff, destination, history } = input;
  if (handoff.source.companyId !== source.company.id)
    refuse("HUBSPOT_SOURCE_CHANGED");
  if (handoff.source.dealId !== (source.deal?.reference.id ?? null))
    refuse("HUBSPOT_NOT_ASSOCIATED");
  const target = handoff.destination;
  if (target.kind === "existing_partner") {
    if (!destination || destination.id !== target.partnerId)
      refuse("PARTNER_NOT_FOUND");
  } else if (destination) refuse("HUBSPOT_OPERATION_CONFLICT");

  const fields: HubSpotFieldChange[] = hubspotPartnerFields.map((field) => {
    const hubspot = proposedValue(source, field);
    const sourceRef = fieldSource(source, field);
    if (target.kind === "new_partner") {
      // A new partner takes what the person confirmed, which may correct
      // HubSpot's spelling; the original stays in the snapshot.
      const result = target[field];
      return {
        field,
        action: result ? "add" : "keep",
        current: "",
        hubspot,
        result,
        drift: "never_imported",
        source: sourceRef,
      };
    }
    const current = destination?.[field] ?? "";
    const drift = classifyHubSpotDrift({
      lastSource: history[field]?.lastSource,
      lastResult: history[field]?.lastResult,
      commerce: current,
      hubspot,
    });
    const chosen = target.fields[field];
    // Changed on both sides: no default, so a missing choice is refused
    // rather than read as "keep".
    if (chosen === undefined && drift === "both_changed")
      refuse("HUBSPOT_DECISION_REQUIRED");
    const decision =
      chosen ??
      (field === "region" && drift === "never_imported"
        ? "keep"
        : (defaultHubSpotDecision({ drift, commerce: current, hubspot }) ??
          "keep"));
    if (decision === "clear" && field === "name")
      refuse("HUBSPOT_DECISION_REQUIRED");
    const { action, result } = hubspotFieldAction(decision, current, hubspot);
    return {
      field,
      action,
      current,
      hubspot,
      result,
      drift,
      source: sourceRef,
    };
  });

  const existingContacts = destination?.contacts ?? [];
  const contacts: HubSpotPlannedContact[] = handoff.contacts.map((choice) => {
    const person =
      source.contacts.find((contact) => contact.id === choice.hubspotId) ??
      refuse("HUBSPOT_CONTACT_NOT_FOUND");
    const linked = existingContacts.find(
      (contact) =>
        contact.source?.portalId === source.portal.portalId &&
        contact.source.objectId === person.id,
    );
    if (choice.matchContactId) {
      const match = existingContacts.find(
        (contact) => contact.id === choice.matchContactId,
      );
      // A match is to a contact with no HubSpot identity, or the same one;
      // it never moves a contact from one HubSpot person to another.
      if (
        !match ||
        // Matching is offered by email only; a list that shifted underneath
        // the review can never pair a person with someone else.
        !person.email ||
        match.email !== person.email ||
        (match.source &&
          !(
            match.source.portalId === source.portal.portalId &&
            match.source.objectId === person.id
          ))
      )
        refuse("HUBSPOT_CONTACT_NOT_FOUND");
    }
    const id = choice.matchContactId ?? linked?.id ?? input.newId();
    return {
      id,
      hubspotId: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      labels: person.labels,
      matchedExisting: Boolean(choice.matchContactId ?? linked),
    };
  });
  if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length)
    refuse("HUBSPOT_CONTACT_NOT_FOUND");
  const primary = handoff.primaryContact;
  const primaryContactId =
    primary === null
      ? null
      : primary.kind === "hubspot"
        ? (contacts.find((contact) => contact.hubspotId === primary.id)?.id ??
          refuse("HUBSPOT_CONTACT_NOT_FOUND"))
        : existingContacts.some((contact) => contact.id === primary.id)
          ? primary.id
          : refuse("HUBSPOT_CONTACT_NOT_FOUND");

  let deal: HubSpotHandoffPlan["deal"] = null;
  if (handoff.includeDeal) {
    const reference =
      source.deal?.reference ?? refuse("HUBSPOT_NOT_ASSOCIATED");
    const endCustomer =
      handoff.endCustomerCompanyId === null
        ? null
        : (reference.associatedCompanies.find(
            (company) => company.id === handoff.endCustomerCompanyId,
          ) ?? refuse("HUBSPOT_NOT_ASSOCIATED"));
    deal = {
      ...reference,
      chosenCompanyId: source.company.id,
      endCustomer,
    };
  }

  if (handoff.notes.length && source.notes === null)
    refuse("HUBSPOT_SCOPE_DENIED");
  const notes = handoff.notes.map(
    (id) =>
      source.notes?.find((note) => note.id === id) ??
      refuse("HUBSPOT_SCOPE_DENIED"),
  );

  const references: HubSpotSourceValue[] = handoff.referenceProperties.map(
    (choice) =>
      (choice.objectType === "company"
        ? source.companyValues
        : (source.deal?.values ?? [])
      ).find((value) => value.property === choice.name) ??
      refuse("HUBSPOT_SCOPE_DENIED"),
  );

  if (handoff.documents.length && source.files === null)
    refuse("HUBSPOT_SCOPE_DENIED");
  const documents = handoff.documents.map((choice) => {
    const file =
      source.files?.find((candidate) => candidate.id === choice.fileId) ??
      refuse("HUBSPOT_DOCUMENT_UNAVAILABLE");
    if (file.availability !== "available")
      refuse("HUBSPOT_DOCUMENT_UNAVAILABLE");
    return {
      fileId: file.id,
      noteId: file.noteId,
      // The attachment store keeps names up to 200 characters.
      fileName: contractPdfFileName(file.name.replace(/\.pdf$/i, "")),
      title: choice.title,
      kind: choice.kind,
      size: file.size,
      updatedAt: file.updatedAt,
    };
  });

  const plan: HubSpotHandoffPlan = {
    operationId: handoff.operationId,
    destination:
      target.kind === "new_partner"
        ? {
            kind: "new_partner",
            partnerId: target.partnerId,
            name: target.name,
            status: target.status,
            ownerId: target.ownerId,
            ownerName: input.ownerName,
            models: target.models,
          }
        : {
            kind: "existing_partner",
            partnerId: target.partnerId,
            name: destination?.name ?? "",
            expectedVersion: target.expectedVersion,
          },
    fields,
    contacts,
    primaryContactId,
    deal,
    notes,
    references,
    documents,
    dismissedSuggestions:
      target.kind === "new_partner" ? target.dismissedSuggestions : [],
    omitted: {
      contacts: source.contacts.length - contacts.length,
      notes: (source.notes?.length ?? 0) - notes.length,
      documents:
        (source.files?.filter((file) => file.availability === "available")
          .length ?? 0) - documents.length,
      properties:
        source.companyValues.length +
        (source.deal?.values.length ?? 0) -
        references.length,
    },
  };

  const fieldValues: HubSpotSourceValue[] = fields.map((field) => ({
    objectType: "company",
    property: field.source.property,
    label: field.source.label,
    type: "string",
    value: field.source.value,
  }));
  const snapshot: HubSpotSourceSnapshot = {
    portalId: source.portal.portalId,
    uiDomain: source.portal.uiDomain,
    retrievedAt: source.retrievedAt,
    company: {
      id: source.company.id,
      url: source.company.url,
      name: source.company.name,
      updatedAt: source.company.updatedAt,
      owner: source.company.owner,
    },
    values: [...fieldValues, ...references],
    deal,
    notes,
  };
  return { plan, snapshot };
}
