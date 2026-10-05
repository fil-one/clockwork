import type { Route } from "next";

import type { Permission } from "@clockwork/contracts";
import type { CommandPaletteItem } from "@clockwork/ui";

import type { Translator } from "@/src/i18n";

import {
  canAccessNavigationItem,
  navigation,
  type ExperienceAudience,
} from "./navigation";

interface CommandAction {
  id: string;
  label: string;
  description: string;
  href: Route;
  keywords: readonly string[];
  requiredPermission?: Permission;
  /** Offered to a reader holding at least one of these. */
  anyPermission?: readonly Permission[];
}

export interface CommandItemContext {
  providerBacked: boolean;
}

const actionsFor = (
  t: Translator,
): Readonly<Record<ExperienceAudience, readonly CommandAction[]>> => ({
  customer: [
    {
      id: "create-quote",
      label: t("action.createQuote"),
      description: t("app.command.action.customerQuote"),
      href: "/quotes/new",
      keywords: ["new", "pricing", "capacity"],
      requiredPermission: "quote:write",
    },
    {
      id: "invite-user",
      label: t("action.invite"),
      description: t("app.command.action.inviteUser"),
      href: "/account/users",
      keywords: ["member", "team", "access"],
      requiredPermission: "account:write",
    },
  ],
  partner: [
    {
      id: "register-deal",
      label: t("action.register"),
      description: t("app.command.action.registerDeal"),
      href: "/partner/registrations",
      keywords: ["new", "opportunity", "client"],
      requiredPermission: "deal:register",
    },
    {
      id: "create-partner-quote",
      label: t("action.createQuote"),
      description: t("app.command.action.partnerQuote"),
      href: "/partner/quotes/new",
      keywords: ["new", "pricing", "client"],
      requiredPermission: "partner:quote:write",
    },
  ],
  internal: [
    {
      id: "open-global-search",
      label: t("nav.internal.search"),
      description: t("app.command.action.globalSearch"),
      href: "/internal/search",
      keywords: ["find", "lookup", "account"],
      requiredPermission: "operations:read",
    },
    {
      id: "review-approvals",
      label: t("action.review"),
      description: t("app.command.action.reviewApprovals"),
      href: "/internal/approvals",
      keywords: ["queue", "exception", "resolve"],
      requiredPermission: "operations:read",
      anyPermission: [
        "quote:approve",
        "agreement:approve",
        "destructive:approve",
      ],
    },
  ],
});

function canAccessAction(
  action: CommandAction,
  permissions: readonly Permission[],
): boolean {
  if (
    action.anyPermission &&
    !action.anyPermission.some((permission) => permissions.includes(permission))
  )
    return false;
  return (
    !action.requiredPermission ||
    permissions.includes(action.requiredPermission)
  );
}

/** Builds the palette data for the active portal without leaking cross-audience actions. */
export function getCommandItems(
  audience: ExperienceAudience,
  permissions: readonly Permission[],
  context: CommandItemContext,
  t: Translator,
): CommandPaletteItem[] {
  const navigationItems: CommandPaletteItem[] = navigation[audience]
    .filter((item) => !item.providerBackedOnly || context.providerBacked)
    .filter((item) => canAccessNavigationItem(item, permissions))
    .map((item) => ({
      id: `navigation-${item.href}`,
      label: t(item.label),
      category: "navigation",
      ...(item.description ? { description: t(item.description) } : {}),
      ...(item.keywords ? { keywords: item.keywords } : {}),
      href: item.href,
      audiences: [audience],
    }));

  const audienceActions = actionsFor(t)[audience];
  const actionItems: CommandPaletteItem[] = audienceActions
    .filter((item) => canAccessAction(item, permissions))

    .map((item) => ({
      id: `action-${item.id}`,
      label: item.label,
      description: item.description,
      href: item.href,
      keywords: item.keywords,
      category: "actions",
      audiences: [audience],
    }));

  // Record search must be populated by an account-scoped search projection.
  // Until that projection is supplied to the shell, fail closed instead of
  // presenting fixture records as production truth.
  const items = [...navigationItems, ...actionItems];
  return context.providerBacked
    ? items.filter((item) => item.category !== "records")
    : items;
}
