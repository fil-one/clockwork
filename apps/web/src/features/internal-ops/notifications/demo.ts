// i18n-exempt-file: fictional demo records (company names, people, notes typed by staff); never interface copy
import "server-only";

import { cookies } from "next/headers";

import {
  defaultSlackNotificationKinds,
  type StaffNotification,
  type StaffNotificationKind,
  type StaffNotificationSettingsRecord,
} from "@clockwork/contracts";

import { demoNow } from "@/src/features/experience-server/demo-clock";

/**
 * What the guided demo's staff personas find in their inbox. Every company
 * and person is fictional, the companies match the demo MNDA and contract
 * registers, and every time is relative to the moment the page is read.
 * Nothing here reaches the database, email or Slack. Which notifications a
 * persona has read is kept in a cookie in their own browser.
 */

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

interface Fixture {
  id: string;
  kind: StaffNotificationKind;
  recordType: string;
  recordId: string;
  href: string;
  subject: string;
  actorName: string | null;
  detail?: string;
  ago: number;
}

const fixtures: readonly Fixture[] = [
  {
    id: "62000000-0000-4000-8000-000000000001",
    kind: "mnda.counterparty_signed",
    recordType: "mnda",
    recordId: "61000000-0000-4000-8000-000000000201",
    href: "/internal/mndas?q=Larkspur%20Genomics%2C%20Inc.",
    subject: "Larkspur Genomics, Inc.",
    actorName: null,
    ago: 25 * minute,
  },
  {
    id: "62000000-0000-4000-8000-000000000002",
    kind: "contract.approval_requested",
    recordType: "contract",
    recordId: "63000000-0000-4000-8000-000000000001",
    href: "/internal/contracts",
    subject: "Brightwater Systems Integrators Ltd",
    actorName: "Jonah Pike",
    ago: 2 * hour,
  },
  {
    id: "62000000-0000-4000-8000-000000000003",
    kind: "handoff.requested",
    recordType: "handoff",
    recordId: "64000000-0000-4000-8000-000000000001",
    href: "/internal/handoffs",
    subject: "Halden Archives AS",
    actorName: "Sofia Marchetti",
    ago: 3 * hour,
  },
  {
    id: "62000000-0000-4000-8000-000000000004",
    kind: "contract.sent_back",
    recordType: "contract",
    recordId: "63000000-0000-4000-8000-000000000002",
    href: "/internal/contracts",
    subject: "Tidewater Media Group LLC",
    actorName: "Imani Ross",
    detail: "Use the 2026 DPA as the order form's data terms.",
    ago: 5 * hour,
  },
  {
    id: "62000000-0000-4000-8000-000000000005",
    kind: "mnda.completed",
    recordType: "mnda",
    recordId: "61000000-0000-4000-8000-000000000202",
    href: "/internal/mndas?q=Fernhill%20Research%20Institute",
    subject: "Fernhill Research Institute",
    actorName: null,
    ago: 1 * day,
  },
  {
    id: "62000000-0000-4000-8000-000000000006",
    kind: "price_book.approval_requested",
    recordType: "price_book",
    recordId: "60000000-0000-4000-8000-000000000001",
    href: "/internal/price-books",
    subject: "Channel partner list (USD v4)",
    actorName: "Mateo Silva",
    ago: 1 * day + 2 * hour,
  },
  {
    id: "62000000-0000-4000-8000-000000000007",
    kind: "contract.executed",
    recordType: "contract",
    recordId: "63000000-0000-4000-8000-000000000003",
    href: "/internal/contracts",
    subject: "Orchard Street Studios Inc.",
    actorName: null,
    ago: 2 * day,
  },
  {
    id: "62000000-0000-4000-8000-000000000008",
    kind: "mnda.attention",
    recordType: "mnda",
    recordId: "61000000-0000-4000-8000-000000000203",
    href: "/internal/mndas?q=Copperline%20Logistics%20Corp.",
    subject: "Copperline Logistics Corp.",
    actorName: null,
    ago: 3 * day,
  },
  {
    id: "62000000-0000-4000-8000-000000000009",
    kind: "handoff.done",
    recordType: "contract",
    recordId: "63000000-0000-4000-8000-000000000004",
    href: "/internal/contracts",
    subject: "Pinecrest Mapping Co.",
    actorName: "Ada Mercer",
    ago: 4 * day,
  },
];

/** Older fixtures start read, so a persona opens on a few unread items. */
const readByDefault = new Set(
  fixtures.filter((f) => f.ago >= day).map((f) => f.id),
);

export const demoNotificationReadCookie = "cw-demo-notifications-read";

async function readIds(): Promise<Set<string>> {
  const raw = (await cookies()).get(demoNotificationReadCookie)?.value ?? "";
  return new Set(raw.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)));
}

export async function demoNotifications(
  kinds: readonly StaffNotificationKind[],
): Promise<StaffNotification[]> {
  const read = await readIds();
  const now = demoNow().getTime();
  return fixtures
    .filter((f) => kinds.includes(f.kind))
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      recordType: f.recordType,
      recordId: f.recordId,
      href: f.href,
      subject: f.subject,
      actorName: f.actorName,
      detail: f.detail ?? null,
      createdAt: new Date(now - f.ago).toISOString(),
      readAt:
        read.has(f.id) || readByDefault.has(f.id)
          ? new Date(now - f.ago + 10 * minute).toISOString()
          : null,
    }));
}

/** Marks fixtures read in this browser only. */
export async function markDemoNotificationsRead(ids: readonly string[]) {
  const known = new Set(fixtures.map((f) => f.id));
  const read = await readIds();
  for (const id of ids) if (known.has(id)) read.add(id);
  (await cookies()).set(demoNotificationReadCookie, [...read].join(","), {
    httpOnly: true,
    sameSite: "lax",
    path: "/internal",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export const demoNotificationIds = () => fixtures.map((f) => f.id);

/** The settings the demo shows: email and Slack off, with the defaults. */
export function demoNotificationSettings(): StaffNotificationSettingsRecord {
  return {
    emailEnabled: false,
    slackEnabled: false,
    emailDisabledKinds: [],
    slackKinds: [...defaultSlackNotificationKinds],
    slackChannelLabel: "#revenue",
    version: 1,
    updatedAt: new Date(demoNow().getTime() - 7 * day).toISOString(),
    updatedBy: null,
  };
}
