export type SearchGroup =
  | "Accounts"
  | "Agreements"
  | "Quotes"
  | "Orders"
  | "Invoices"
  | "End clients"
  | "Queues"
  | "Documents";

export interface SearchRecord {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string;
  href: string;
  status: string;
}

export const SEARCH_GROUPS: readonly SearchGroup[] = [
  "Accounts",
  "Agreements",
  "Quotes",
  "Orders",
  "Invoices",
  "End clients",
  "Queues",
  "Documents",
];

export const SEARCH_RECORDS: readonly SearchRecord[] = [
  {
    id: "acct_northstar",
    group: "Accounts",
    title: "Northstar Archive Labs",
    subtitle: "Direct buyer · account owner Maya Chen",
    href: "/internal/accounts/acct_northstar",
    status: "Active",
  },
  {
    id: "acct_meridian",
    group: "Accounts",
    title: "Meridian Channel Group",
    subtitle: "Reseller · United States",
    href: "/internal/accounts/acct_meridian",
    status: "Active",
  },
  {
    id: "AGR-2026-0042",
    group: "Agreements",
    title: "Cloud Service Agreement",
    subtitle: "Northstar Archive Labs · Fil One paper · v3.2",
    href: "/internal/agreements",
    status: "Signed",
  },
  {
    id: "AGR-2026-0061",
    group: "Agreements",
    title: "Customer security addendum",
    subtitle: "Northstar Archive Labs · four key terms under review",
    href: "/internal/agreements",
    status: "Review",
  },
  {
    id: "Q-2026-0184-v3",
    group: "Quotes",
    title: "Enterprise committed capacity",
    subtitle: "Halcyon Research Cooperative · 400 TB · annual",
    href: "/internal/queues/EXC-PRC-019",
    status: "Awaiting approval",
  },
  {
    id: "Q-2026-0171-v1",
    group: "Quotes",
    title: "Annual business expansion",
    subtitle: "Northstar Archive Labs · 80 TB · EU West",
    href: "/internal/accounts/acct_northstar",
    status: "Draft",
  },
  {
    id: "ORD-2026-0098",
    group: "Orders",
    title: "Northstar primary archive",
    subtitle: "Northstar Archive Labs · 500 TB · US East",
    href: "/internal/accounts/acct_northstar",
    status: "Active",
  },
  {
    id: "ORD-2026-0112",
    group: "Orders",
    title: "Madrid compliance replica",
    subtitle: "Northstar Archive Labs · 120 TB · EU West",
    href: "/internal/provisioning",
    status: "Provisioning",
  },
  {
    id: "INV-2026-0781",
    group: "Invoices",
    title: "Northstar July service invoice",
    subtitle: "$15,400 final invoice truth · PO-NA-1048",
    href: "/internal/collections",
    status: "Overdue",
  },
  {
    id: "INV-2026-0712",
    group: "Invoices",
    title: "Northstar June service invoice",
    subtitle: "$15,400 collected Jul 3 · ACH",
    href: "/internal/collections",
    status: "Paid",
  },
  {
    id: "EC-0038",
    group: "End clients",
    title: "Halcyon Research Cooperative",
    subtitle: "Resale · 280 TB · renewal action Sep 2",
    href: "/internal/renewals",
    status: "In notice",
  },
  {
    id: "EC-0047",
    group: "End clients",
    title: "Atlas Field Imaging",
    subtitle: "Distributor → reseller · POC active",
    href: "/internal/migrations",
    status: "Review",
  },
  {
    id: "EXC-COL-008",
    group: "Queues",
    title: "Collections aging decision",
    subtitle: "Northstar Archive Labs · owner Amina Cole",
    href: "/internal/queues/EXC-COL-008",
    status: "SLA breached",
  },
  {
    id: "EXC-SCR-004",
    group: "Queues",
    title: "Restricted-party possible match",
    subtitle: "Atlas Field Imaging · owner James Kurz",
    href: "/internal/queues/EXC-SCR-004",
    status: "Blocked",
  },
  {
    id: "EXC-PRC-019",
    group: "Queues",
    title: "Pricing exception for Halcyon expansion",
    subtitle: "Halcyon Research Cooperative · owner James Kurz",
    href: "/internal/queues/EXC-PRC-019",
    status: "Due soon",
  },
  {
    id: "DOC-CSA-3.2",
    group: "Documents",
    title: "Cloud Service Agreement v3.2",
    subtitle: "Approved template · effective Jul 1, 2026",
    href: "/internal/agreements",
    status: "Current",
  },
  {
    id: "DOC-COL-PLAYBOOK",
    group: "Documents",
    title: "Collections escalation playbook",
    subtitle: "Operations policy · FIN-COL-04",
    href: "/internal/collections",
    status: "Current",
  },
];

export function searchRecords(
  query: string,
  records: readonly SearchRecord[] = SEARCH_RECORDS,
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return records.filter((record) => {
    const haystack =
      `${record.title} ${record.subtitle} ${record.id} ${record.group} ${record.status}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function groupSearchResults(results: readonly SearchRecord[]) {
  return SEARCH_GROUPS.map((group) => ({
    group,
    results: results.filter((record) => record.group === group),
  })).filter((entry) => entry.results.length > 0);
}

export function nextSearchIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  count: number,
) {
  if (count === 0) return -1;
  if (key === "ArrowDown") return current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}
