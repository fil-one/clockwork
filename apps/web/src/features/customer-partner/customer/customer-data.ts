import type { Permission } from "@clockwork/contracts";

import { customerPartnerCopy } from "../copy";
import type { CustomerCollectionRecord } from "./collection-state";

export type CustomerCollectionKey =
  "amendments" | "users" | "procurement" | "marketplace" | "support";

export interface CustomerCollectionConfig {
  key: CustomerCollectionKey;
  title: string;
  description: string;
  searchPlaceholder: string;
  permission: Permission;
  path: string;
  recordLabel: string;
  valueLabel: string;
  ownerLabel: string;
  providerNote?: string;
  records: readonly CustomerCollectionRecord[];
}

const amendmentRecords: readonly CustomerCollectionRecord[] = [
  {
    id: "AMD-2026-0028",
    title: "Madrid replica capacity increase",
    description: "Adds 40 TB to the compliance replica after acceptance.",
    status: "review",
    statusLabel: "Review",
    risk: "medium",
    owner: "Maya Chen",
    value: "+$10,560 / year",
    valueSort: 10560,
    updatedAt: "2026-07-31T14:42:00Z",
    updatedLabel: "Updated 1 hour ago",
    href: "/orders/ORD-2026-0112",
    context: [
      { label: "Service", value: "Madrid compliance replica" },
      { label: "Effective", value: "Aug 15, 2026" },
    ],
  },
  {
    id: "AMD-2026-0024",
    title: "Primary archive purchase-order update",
    description: "Replaces the customer PO; commitment is unchanged.",
    status: "pending",
    statusLabel: "Awaiting customer",
    risk: "low",
    owner: "Elias Romero",
    value: "No spend change",
    valueSort: 0,
    updatedAt: "2026-07-30T18:12:00Z",
    updatedLabel: "Updated yesterday",
    href: "/orders/ORD-2026-0098",
    context: [
      { label: "Service", value: "Northstar primary archive" },
      { label: "Needed", value: "Replacement PO" },
    ],
  },
  {
    id: "AMD-2026-0019",
    title: "Support-response schedule",
    description: "Adds the enhanced response schedule to both services.",
    status: "active",
    statusLabel: "Effective",
    risk: "low",
    owner: "Maya Chen",
    value: "$3,600 / year",
    valueSort: 3600,
    updatedAt: "2026-07-25T11:20:00Z",
    updatedLabel: "Updated Jul 25",
    href: "/orders/ORD-2026-0098",
    context: [
      { label: "Services", value: "2 active services" },
      { label: "Effective", value: "Jul 25, 2026" },
    ],
  },
  {
    id: "AMD-2026-0014",
    title: "EU data-residency clarification",
    description: "Clarifies permitted processing regions without price impact.",
    status: "complete",
    statusLabel: "Completed",
    risk: "low",
    owner: "Maya Chen",
    value: "No spend change",
    valueSort: 0,
    updatedAt: "2026-07-18T09:00:00Z",
    updatedLabel: "Updated Jul 18",
    href: "/orders/ORD-2026-0112",
    context: [
      { label: "Agreement", value: "Cloud Service Agreement v3.2" },
      { label: "Evidence", value: "Signed addendum" },
    ],
  },
  {
    id: "AMD-2026-0007",
    title: "Early-start request",
    description: "Request closed after the original service date was retained.",
    status: "blocked",
    statusLabel: "Closed · not accepted",
    risk: "medium",
    owner: "Amina Cole",
    value: "No commitment",
    valueSort: 0,
    updatedAt: "2026-07-07T16:00:00Z",
    updatedLabel: "Updated Jul 7",
    href: "/orders/ORD-2026-0112",
    context: [
      { label: "Reason", value: "Purchase order not available" },
      { label: "Service start", value: "Jul 15, 2026" },
    ],
  },
];

const userRecords: readonly CustomerCollectionRecord[] = [
  {
    id: "USR-MAYA",
    title: "Maya Chen",
    description: "Account owner with all customer commerce approvals.",
    status: "active",
    statusLabel: "Active",
    risk: "low",
    owner: "Maya Chen",
    value: "Owner",
    valueSort: 5,
    updatedAt: "2026-07-31T15:22:00Z",
    updatedLabel: "Active today",
    context: [
      { label: "Access", value: "All customer workflows" },
      { label: "Security", value: "MFA verified" },
    ],
  },
  {
    id: "USR-ELIAS",
    title: "Elias Romero",
    description: "Billing contact for invoices, payments, and tax records.",
    status: "active",
    statusLabel: "Active",
    risk: "low",
    owner: "Maya Chen",
    value: "Billing",
    valueSort: 4,
    updatedAt: "2026-07-31T12:14:00Z",
    updatedLabel: "Active today",
    context: [
      { label: "Approval limit", value: "$50,000" },
      { label: "Security", value: "MFA verified" },
    ],
  },
  {
    id: "USR-NORA",
    title: "Nora Dlamini",
    description: "Member with read access to agreements and services.",
    status: "active",
    statusLabel: "Active",
    risk: "low",
    owner: "Maya Chen",
    value: "Member",
    valueSort: 2,
    updatedAt: "2026-07-29T08:10:00Z",
    updatedLabel: "Active Jul 29",
    context: [
      { label: "Access", value: "View commercial records" },
      { label: "Security", value: "MFA verified" },
    ],
  },
  {
    id: "INV-JUNO",
    title: "Juno Okafor",
    description: "Invited as an account administrator and legal approver.",
    status: "pending",
    statusLabel: "Invitation pending",
    risk: "medium",
    owner: "Maya Chen",
    value: "Admin",
    valueSort: 3,
    updatedAt: "2026-07-28T13:40:00Z",
    updatedLabel: "Invited Jul 28",
    context: [
      { label: "Expires", value: "Aug 6, 2026" },
      { label: "Security", value: "MFA not yet enrolled" },
    ],
  },
  {
    id: "USR-PRIYA",
    title: "Priya Shah",
    description: "Former procurement member retained in audit evidence.",
    status: "complete",
    statusLabel: "Access removed",
    risk: "low",
    owner: "Maya Chen",
    value: "Former member",
    valueSort: 1,
    updatedAt: "2026-07-02T17:00:00Z",
    updatedLabel: "Removed Jul 2",
    context: [
      { label: "Access", value: "No current access" },
      { label: "Evidence", value: "Removal recorded" },
    ],
  },
];

const procurementRecords: readonly CustomerCollectionRecord[] = [
  {
    id: "PROC-AP",
    title: "Accounts payable routing",
    description: "Routes invoices and credits to the verified billing inbox.",
    status: "active",
    statusLabel: "Verified",
    risk: "low",
    owner: "Elias Romero",
    value: "ap@northstar.example",
    valueSort: 5,
    updatedAt: "2026-07-31T10:10:00Z",
    updatedLabel: "Verified today",
    context: [
      { label: "Invoice delivery", value: "Email and portal" },
      { label: "Credit delivery", value: "Email" },
    ],
  },
  {
    id: "PROC-COUPA",
    title: "Coupa supplier onboarding",
    description: "Customer supplier setup is waiting on its bank check.",
    status: "pending",
    statusLabel: "Awaiting bank check",
    risk: "medium",
    owner: "Elias Romero",
    value: "Due Aug 12",
    valueSort: 12,
    updatedAt: "2026-07-30T09:15:00Z",
    updatedLabel: "Updated yesterday",
    context: [
      { label: "System", value: "Coupa" },
      { label: "Next step", value: "Customer bank verification" },
    ],
  },
  {
    id: "TAX-US-019",
    title: "US resale exemption",
    description: "New York sales-tax exemption evidence on file.",
    status: "active",
    statusLabel: "Current",
    risk: "low",
    owner: "Elias Romero",
    value: "Expires Mar 31, 2027",
    valueSort: 20270331,
    updatedAt: "2026-07-21T13:00:00Z",
    updatedLabel: "Updated Jul 21",
    context: [
      { label: "Jurisdiction", value: "New York" },
      { label: "Document", value: "Exemption certificate" },
    ],
  },
  {
    id: "PO-NA-1081",
    title: "Madrid replica purchase order",
    description: "Purchase order accepted for the EU compliance service.",
    status: "complete",
    statusLabel: "Accepted",
    risk: "low",
    owner: "Elias Romero",
    value: "$31,680 / year",
    valueSort: 31680,
    updatedAt: "2026-07-15T12:00:00Z",
    updatedLabel: "Accepted Jul 15",
    context: [
      { label: "Service", value: "Madrid compliance replica" },
      { label: "Order", value: "ORD-2026-0112" },
    ],
  },
  {
    id: "PROC-W9",
    title: "Supplier tax form",
    description: "Current supplier tax documentation available for download.",
    status: "active",
    statusLabel: "Current",
    risk: "low",
    owner: "Elias Romero",
    value: "2026 form",
    valueSort: 2026,
    updatedAt: "2026-06-18T10:00:00Z",
    updatedLabel: "Updated Jun 18",
    context: [
      { label: "Entity", value: "Fil One, Inc." },
      { label: "Classification", value: "Corporation" },
    ],
  },
];

const marketplaceRecords: readonly CustomerCollectionRecord[] = [
  {
    id: "AWS-OFFER-1948",
    title: "AWS private offer · primary archive",
    description: "Provider reports that the accepted offer is fulfilled.",
    status: "active",
    statusLabel: "Active",
    risk: "low",
    owner: "Elias Romero",
    value: "$184,800 / year",
    valueSort: 184800,
    updatedAt: "2026-07-31T15:42:00Z",
    updatedLabel: "Provider sync 18 min ago",
    context: [
      { label: "Marketplace", value: "AWS Marketplace" },
      { label: "Billing", value: "AWS is merchant of record" },
    ],
  },
  {
    id: "AZURE-OFFER-0412",
    title: "Azure offer · UK expansion",
    description:
      "The offer is available in the buyer account but not accepted.",
    status: "pending",
    statusLabel: "Buyer acceptance needed",
    risk: "medium",
    owner: "Maya Chen",
    value: "£72,990 / year",
    valueSort: 72990,
    updatedAt: "2026-07-30T16:30:00Z",
    updatedLabel: "Provider sync yesterday",
    context: [
      { label: "Marketplace", value: "Azure Marketplace" },
      { label: "Expires", value: "Aug 4, 2026" },
    ],
  },
  {
    id: "GCP-OFFER-0087",
    title: "Google Cloud offer · Madrid replica",
    description: "Disbursement is pending in the read-only provider feed.",
    status: "review",
    statusLabel: "Disbursement pending",
    risk: "low",
    owner: "Elias Romero",
    value: "€31,680 / year",
    valueSort: 31680,
    updatedAt: "2026-07-29T20:00:00Z",
    updatedLabel: "Provider sync Jul 29",
    context: [
      { label: "Marketplace", value: "Google Cloud Marketplace" },
      { label: "Billing", value: "Google is merchant of record" },
    ],
  },
  {
    id: "AWS-OFFER-1764",
    title: "AWS private offer · recovery sandbox",
    description: "Expired offer retained as commercial audit evidence.",
    status: "complete",
    statusLabel: "Expired",
    risk: "low",
    owner: "Maya Chen",
    value: "$4,200 estimate",
    valueSort: 4200,
    updatedAt: "2026-07-09T12:00:00Z",
    updatedLabel: "Expired Jul 9",
    context: [
      { label: "Marketplace", value: "AWS Marketplace" },
      { label: "Commitment", value: "None" },
    ],
  },
];

const supportRecords: readonly CustomerCollectionRecord[] = [
  {
    id: "SUP-18421",
    title: "Restore sample timing",
    description: "Support is reviewing the latest sample recovery timings.",
    status: "active",
    statusLabel: "In progress",
    risk: "low",
    owner: "Nora Dlamini",
    value: "Normal priority",
    valueSort: 2,
    updatedAt: "2026-07-31T15:32:00Z",
    updatedLabel: "Provider update 28 min ago",
    context: [
      { label: "Service", value: "Northstar primary archive" },
      { label: "Source", value: "Support provider" },
    ],
  },
  {
    id: "SUP-18307",
    title: "EU usage export",
    description:
      "Support needs the requested export time range from the customer.",
    status: "pending",
    statusLabel: "Awaiting customer",
    risk: "low",
    owner: "Nora Dlamini",
    value: "Normal priority",
    valueSort: 2,
    updatedAt: "2026-07-30T14:15:00Z",
    updatedLabel: "Provider update yesterday",
    context: [
      { label: "Service", value: "Madrid compliance replica" },
      { label: "Next step", value: "Confirm export range" },
    ],
  },
  {
    id: "SUP-18288",
    title: "Marketplace invoice reference",
    description: "AWS invoice reference was reconciled with the service order.",
    status: "complete",
    statusLabel: "Resolved",
    risk: "low",
    owner: "Elias Romero",
    value: "Resolved",
    valueSort: 1,
    updatedAt: "2026-07-27T09:35:00Z",
    updatedLabel: "Resolved Jul 27",
    context: [
      { label: "Invoice", value: "INV-2026-0781" },
      { label: "Source", value: "Support provider" },
    ],
  },
  {
    id: "SUP-18159",
    title: "Provisioning status clarification",
    description:
      "Provider escalation completed; provisioning remains in progress.",
    status: "complete",
    statusLabel: "Resolved",
    risk: "medium",
    owner: "Maya Chen",
    value: "High priority",
    valueSort: 3,
    updatedAt: "2026-07-22T18:00:00Z",
    updatedLabel: "Resolved Jul 22",
    context: [
      { label: "Order", value: "ORD-2026-0112" },
      { label: "Evidence", value: "Provider response attached" },
    ],
  },
];

const copy = customerPartnerCopy.customer.collections;

export const customerCollections: Readonly<
  Record<CustomerCollectionKey, CustomerCollectionConfig>
> = {
  amendments: {
    key: "amendments",
    ...copy.amendments,
    permission: "order:write",
    path: "/amendments",
    recordLabel: "Amendment",
    valueLabel: "Commercial impact",
    ownerLabel: "Owner",
    records: amendmentRecords,
  },
  users: {
    key: "users",
    ...copy.users,
    permission: "account:write",
    path: "/account/users",
    recordLabel: "Person",
    valueLabel: "Role",
    ownerLabel: "Managed by",
    records: userRecords,
  },
  procurement: {
    key: "procurement",
    ...copy.procurement,
    permission: "account:write",
    path: "/account/procurement",
    recordLabel: "Requirement",
    valueLabel: "State / value",
    ownerLabel: "Owner",
    records: procurementRecords,
  },
  marketplace: {
    key: "marketplace",
    ...copy.marketplace,
    permission: "account:read",
    path: "/marketplace",
    recordLabel: "Offer",
    valueLabel: "Offer value",
    ownerLabel: "Customer owner",
    providerNote:
      "Marketplace status is provider-reported. Open the provider only from a selected offer and verify the account before continuing.",
    records: marketplaceRecords,
  },
  support: {
    key: "support",
    ...copy.support,
    permission: "account:read",
    path: "/support",
    recordLabel: "Issue",
    valueLabel: "Priority / outcome",
    ownerLabel: "Customer contact",
    providerNote:
      "The support provider is the source of truth. Fil One shows a synchronized summary and does not duplicate provider-only actions.",
    records: supportRecords,
  },
};
