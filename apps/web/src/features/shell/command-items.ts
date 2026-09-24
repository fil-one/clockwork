import type { Route } from "next";

import {
  hasPermission,
  roles as commerceRoles,
  type Permission,
  type Role,
} from "@clockwork/contracts";
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
  allowedRoles?: readonly Role[];
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
    },
    {
      id: "review-approvals",
      label: t("action.review"),
      description: t("app.command.action.reviewApprovals"),
      href: "/internal/approvals",
      keywords: ["queue", "exception", "resolve"],
      allowedRoles: [
        "finance_approver",
        "legal_approver",
        "destructive_action_approver",
      ],
    },
  ],
});

function isCommerceRole(role: string): role is Role {
  return (commerceRoles as readonly string[]).includes(role);
}

function canAccessAction(
  action: CommandAction,
  roles: readonly string[],
): boolean {
  const actionRoles = action.allowedRoles;
  if (
    actionRoles &&
    !roles.some((role) => isCommerceRole(role) && actionRoles.includes(role))
  ) {
    return false;
  }

  const requiredPermission = action.requiredPermission;
  if (!requiredPermission) return true;
  return roles.some(
    (role) => isCommerceRole(role) && hasPermission(role, requiredPermission),
  );
}

/** Builds the palette data for the active portal without leaking cross-audience actions. */
export function getCommandItems(
  audience: ExperienceAudience,
  roles: readonly string[],
  context: CommandItemContext,
  t: Translator,
): CommandPaletteItem[] {
  const navigationItems: CommandPaletteItem[] = navigation[audience]
    .filter((item) => canAccessNavigationItem(item, roles))
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
    .filter((item) => canAccessAction(item, roles))
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
