import type { Route } from "next";

import type { CommandPaletteItem } from "@clockwork/ui";

import {
  endClients,
  invoices,
  orders,
  queues,
  quotes,
} from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

import { navigation, type ExperienceAudience } from "./navigation";

interface CommandAction {
  id: string;
  label: string;
  description: string;
  href: Route;
  keywords: readonly string[];
}

const actions: Readonly<Record<ExperienceAudience, readonly CommandAction[]>> =
  {
    customer: [
      {
        id: "create-quote",
        label: t("action.createQuote"),
        description: t("app.command.action.customerQuote"),
        href: "/quotes/new",
        keywords: ["new", "pricing", "capacity"],
      },
      {
        id: "invite-user",
        label: t("action.invite"),
        description: t("app.command.action.inviteUser"),
        href: "/account/users",
        keywords: ["member", "team", "access"],
      },
    ],
    partner: [
      {
        id: "register-deal",
        label: t("action.register"),
        description: t("app.command.action.registerDeal"),
        href: "/partner/registrations",
        keywords: ["new", "opportunity", "client"],
      },
      {
        id: "create-partner-quote",
        label: t("action.createQuote"),
        description: t("app.command.action.partnerQuote"),
        href: "/partner/quotes/new",
        keywords: ["new", "pricing", "client"],
      },
    ],
    internal: [
      {
        id: "open-global-search",
        label: t("nav.internal.search"),
        description: t("app.command.action.globalSearch"),
        href: "/internal/search",
        keywords: ["find", "lookup", "account"],
      },
      {
        id: "review-approvals",
        label: t("action.review"),
        description: t("app.command.action.reviewApprovals"),
        href: "/internal/approvals",
        keywords: ["queue", "exception", "resolve"],
      },
    ],
  };

function recordItems(audience: ExperienceAudience): CommandPaletteItem[] {
  if (audience === "partner") {
    return endClients.slice(0, 3).map((record) => ({
      id: `record-${record.id}`,
      label: `${record.id} · ${record.title}`,
      category: "records",
      description: record.meta,
      keywords: [record.id, record.title, record.value ?? "", "end client"],
      href: `/partner/portfolio/${record.id}`,
      audiences: [audience],
    }));
  }

  if (audience === "internal") {
    return queues.slice(0, 4).map((record) => ({
      id: `record-${record.id}`,
      label: `${record.id} · ${record.title}`,
      category: "records",
      description: record.meta,
      keywords: [record.id, record.title, record.value ?? "", "exception"],
      href: `/internal/queues/${record.id}`,
      audiences: [audience],
    }));
  }

  return [
    ...quotes.slice(0, 2).map((record) => ({
      id: `record-${record.id}`,
      label: `${record.id} · ${record.title}`,
      category: "records" as const,
      description: record.meta,
      keywords: [record.id, record.title, record.value ?? "", "quote"],
      href: `/quotes/${record.id}`,
      audiences: [audience],
    })),
    ...orders.slice(0, 2).map((record) => ({
      id: `record-${record.id}`,
      label: `${record.id} · ${record.title}`,
      category: "records" as const,
      description: record.meta,
      keywords: [record.id, record.title, record.value ?? "", "order"],
      href: `/orders/${record.id}`,
      audiences: [audience],
    })),
    ...invoices.slice(0, 2).map((record) => ({
      id: `record-${record.id}`,
      label: `${record.id} · ${record.title}`,
      category: "records" as const,
      description: record.meta,
      keywords: [record.id, record.title, record.value ?? "", "invoice"],
      href: "/billing",
      audiences: [audience],
    })),
  ];
}

/** Builds the palette data for the active portal without leaking cross-audience actions. */
export function getCommandItems(
  audience: ExperienceAudience,
): CommandPaletteItem[] {
  const navigationItems: CommandPaletteItem[] = navigation[audience].map(
    (item) => ({
      id: `navigation-${item.href}`,
      label: t(item.label),
      category: "navigation",
      ...(item.description ? { description: t(item.description) } : {}),
      ...(item.keywords ? { keywords: item.keywords } : {}),
      href: item.href,
      audiences: [audience],
    }),
  );

  const actionItems: CommandPaletteItem[] = actions[audience].map((item) => ({
    ...item,
    id: `action-${item.id}`,
    category: "actions",
    audiences: [audience],
  }));

  return [...navigationItems, ...actionItems, ...recordItems(audience)];
}
