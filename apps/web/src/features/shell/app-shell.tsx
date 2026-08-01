"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState, useTransition } from "react";

import {
  AppShell as StructuralAppShell,
  BadgeDollarSign,
  Building2,
  Button,
  ChevronDown,
  CircleHelp,
  CommandPalette,
  FileText,
  FlaskConical,
  Handshake,
  Inbox,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ScrollText,
  Settings,
  SlidersHorizontal,
  StatusBadge,
  Users,
  ChartNoAxesCombined,
  type CommandPaletteItem,
  type NavigationGroup,
} from "@clockwork/ui";

import { switchCommerceAccount } from "@/src/auth/actions";
import { t } from "@/src/i18n/en";

import { getCommandItems } from "./command-items";
import {
  canAccessNavigationItem,
  isNavigationItemActive,
  navigation,
  type ExperienceAudience,
} from "./navigation";
import type { RouteSession } from "./route-session";

const audienceHome: Readonly<Record<ExperienceAudience, Route>> = {
  customer: "/dashboard",
  partner: "/partner",
  internal: "/internal",
};

const navigationIcons: Readonly<Record<string, ReactNode>> = {
  "/dashboard": <LayoutDashboard size={19} strokeWidth={1.8} />,
  "/agreements": <FileText size={19} strokeWidth={1.8} />,
  "/quotes": <ScrollText size={19} strokeWidth={1.8} />,
  "/orders": <PackageCheck size={19} strokeWidth={1.8} />,
  "/services": <PackageCheck size={19} strokeWidth={1.8} />,
  "/pocs": <FlaskConical size={19} strokeWidth={1.8} />,
  "/billing": <ReceiptText size={19} strokeWidth={1.8} />,
  "/amendments": <FileText size={19} strokeWidth={1.8} />,
  "/marketplace": <Building2 size={19} strokeWidth={1.8} />,
  "/support": <CircleHelp size={19} strokeWidth={1.8} />,
  "/account": <Settings size={19} strokeWidth={1.8} />,
  "/partner": <LayoutDashboard size={19} strokeWidth={1.8} />,
  "/partner/portfolio": <Users size={19} strokeWidth={1.8} />,
  "/partner/registrations": <Handshake size={19} strokeWidth={1.8} />,
  "/partner/quotes": <ScrollText size={19} strokeWidth={1.8} />,
  "/partner/billing": <ReceiptText size={19} strokeWidth={1.8} />,
  "/partner/commissions": <BadgeDollarSign size={19} strokeWidth={1.8} />,
  "/partner/renewals": <RefreshCw size={19} strokeWidth={1.8} />,
  "/partner/disputes": <Inbox size={19} strokeWidth={1.8} />,
  "/partner/marketplace": <Building2 size={19} strokeWidth={1.8} />,
  "/partner/sandboxes": <SlidersHorizontal size={19} strokeWidth={1.8} />,
  "/partner/brand": <Settings size={19} strokeWidth={1.8} />,
  "/partner/support": <CircleHelp size={19} strokeWidth={1.8} />,
  "/internal": <LayoutDashboard size={19} strokeWidth={1.8} />,
  "/internal/search": <Search size={19} strokeWidth={1.8} />,
  "/internal/queues": <Inbox size={19} strokeWidth={1.8} />,
  "/internal/renewals": <RefreshCw size={19} strokeWidth={1.8} />,
  "/internal/collections": <ReceiptText size={19} strokeWidth={1.8} />,
  "/internal/provisioning": <PackageCheck size={19} strokeWidth={1.8} />,
  "/internal/migrations": <RefreshCw size={19} strokeWidth={1.8} />,
  "/internal/reports": <ChartNoAxesCombined size={19} strokeWidth={1.8} />,
  "/internal/agreements": <FileText size={19} strokeWidth={1.8} />,
  "/internal/approvals": <Inbox size={19} strokeWidth={1.8} />,
  "/internal/price-books": <Settings size={19} strokeWidth={1.8} />,
  "/internal/gates": <SlidersHorizontal size={19} strokeWidth={1.8} />,
  "/internal/assisted": <Users size={19} strokeWidth={1.8} />,
};

function Wordmark({ audience }: { audience: ExperienceAudience }) {
  return (
    <Link
      className="wordmark"
      href={audienceHome[audience]}
      aria-label={`${t("app.name")} ${t("app.product")}`}
    >
      <span aria-hidden="true">FIL ONE</span>
      <small>{t("app.product")}</small>
    </Link>
  );
}

function OrganizationSwitcher({
  session,
  announce,
}: {
  session: RouteSession;
  announce: (message: string) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(session.selectedAccountId);
  const [pending, startTransition] = useTransition();
  const selectId = useId();
  const organizationSwitchAllowed =
    session.authenticationSource === "local" ||
    (session.authenticationSource === "workos" && !session.assistedSession);

  useEffect(
    () => setSelected(session.selectedAccountId),
    [session.selectedAccountId],
  );

  const changeOrganization = (accountId: string) => {
    if (!organizationSwitchAllowed) {
      announce(
        session.assistedSession
          ? "Exit assisted mode before switching organizations."
          : "Organization switching is unavailable for this authenticated proof session.",
      );
      return;
    }
    const membership = session.memberships.find(
      (candidate) => candidate.accountId === accountId,
    );
    if (!membership) {
      announce("That account is not an authorized membership.");
      return;
    }

    setSelected(accountId);
    announce(t("app.account.switched", { account: membership.accountName }));
    if (!session.providerBacked) {
      router.push(membership.home);
      return;
    }
    startTransition(async () => {
      const result = await switchCommerceAccount(accountId);
      if (!result.ok) {
        setSelected(session.selectedAccountId);
        announce(
          "Organization switch was denied. Your session was not changed.",
        );
      }
    });
  };

  return (
    <label className="organization-switcher" htmlFor={selectId}>
      <span>{t("app.account.switch")}</span>
      <span className="organization-switcher__control">
        <Building2 aria-hidden="true" size={17} strokeWidth={1.8} />
        <select
          id={selectId}
          value={selected}
          disabled={pending || !organizationSwitchAllowed}
          aria-describedby={
            !organizationSwitchAllowed
              ? `${selectId}-switch-disabled`
              : undefined
          }
          onChange={(event) => changeOrganization(event.target.value)}
        >
          {session.memberships.map((membership) => (
            <option
              key={membership.organizationId}
              value={membership.accountId}
            >
              {membership.accountName}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
      {!organizationSwitchAllowed ? (
        <span className="sr-only" id={`${selectId}-switch-disabled`}>
          {session.assistedSession
            ? "Exit assisted mode before switching organizations."
            : "Organization switching is unavailable for this authenticated proof session."}
        </span>
      ) : null}
    </label>
  );
}

function ShellUtilities({
  audience,
  commandItems,
  profile,
  providerBacked,
}: {
  audience: ExperienceAudience;
  commandItems: readonly CommandPaletteItem[];
  profile: RouteSession["profile"];
  providerBacked: boolean;
}) {
  const router = useRouter();
  const helpHref: Route =
    audience === "partner"
      ? "/partner/support"
      : audience === "internal"
        ? "/internal/gates"
        : "/support";
  const helpLabel = t(
    audience === "internal" ? "app.help.internal" : "app.help",
  );
  const helpDescription = t(
    audience === "internal"
      ? "app.help.internal.description"
      : "app.help.description",
  );
  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <nav className="header-actions" aria-label={t("app.nav.secondary")}>
      <CommandPalette
        audience={audience}
        items={commandItems}
        title={t("app.command.title")}
        description={t("app.command.description")}
        searchLabel={t("app.command.searchLabel")}
        placeholder={t("app.search.hint")}
        noResultsLabel={t("app.command.noResults")}
        groupLabels={{
          navigation: t("app.command.group.navigation"),
          actions: t("app.command.group.actions"),
          records: t("app.command.group.records"),
        }}
        onSelect={(item) => {
          if (item.href) router.push(item.href as Route);
        }}
        trigger={
          <Button
            variant="secondary"
            className="top-action"
            aria-label={t("app.command.title")}
            title={t("app.command.title")}
          >
            <Search aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{t("app.search")}</span>
            <kbd aria-hidden="true">⌘/Ctrl K</kbd>
          </Button>
        }
      />
      {!providerBacked ? (
        <StatusBadge tone="warning">{t("app.demo.short")}</StatusBadge>
      ) : null}
      <Link
        className="icon-action"
        href={helpHref}
        aria-label={helpLabel}
        title={helpDescription}
      >
        <CircleHelp aria-hidden="true" size={19} strokeWidth={1.8} />
      </Link>
      <details className="utility-menu">
        <summary
          className="avatar"
          aria-label={t("app.profile")}
          title={t("app.profile")}
        >
          {initials || "U"}
        </summary>
        <div className="utility-popover">
          <strong>{profile.name}</strong>
          <p>{profile.email}</p>
        </div>
      </details>
    </nav>
  );
}

export function AppShell({
  audience,
  session,
  children,
}: {
  audience: ExperienceAudience;
  session: RouteSession;
  children: ReactNode;
}) {
  const roles = session.roles;
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const runtimeEnvironment =
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? "local";
  const commandItems = useMemo(
    () =>
      getCommandItems(audience, roles, {
        providerBacked: session.providerBacked,
      }),
    [audience, roles, session.providerBacked],
  );
  const navigationGroups = useMemo<readonly NavigationGroup[]>(
    () => [
      {
        id: `${audience}-navigation`,
        items: navigation[audience]
          .filter((item) => canAccessNavigationItem(item, roles))
          .map((item) => ({
            id: item.href,
            href: item.href,
            label: t(item.label),
            icon: navigationIcons[item.href],
            active: isNavigationItemActive(item, pathname),
          })),
      },
    ],
    [audience, pathname, roles],
  );

  const resetDemo = () => {
    if (runtimeEnvironment === "production") {
      setAnnouncement(t("state.fatal.description"));
      return;
    }
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("clockwork-demo:"))
        window.localStorage.removeItem(key);
    }
    setAnnouncement(t("app.demo.reset.success"));
    window.location.assign(pathname);
  };

  useEffect(() => {
    setHydrated(true);
    const update = () => {
      const next = navigator.onLine;
      setOnline(next);
      setAnnouncement(t(next ? "app.online" : "app.offline"));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const banner = (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {!online ? (
        <div className="connection-banner" role="status">
          {t("app.offline")}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className="experience-shell"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <StructuralAppShell
        navigation={navigationGroups}
        brand={<Wordmark audience={audience} />}
        organization={
          <OrganizationSwitcher session={session} announce={setAnnouncement} />
        }
        utilities={
          <ShellUtilities
            audience={audience}
            commandItems={commandItems}
            profile={session.profile}
            providerBacked={session.providerBacked}
          />
        }
        banner={banner}
        footer={
          <div className="shell-footer-content">
            {!session.providerBacked ? (
              <div className="sidebar-meta">
                <StatusBadge tone="warning">{t("app.demo")}</StatusBadge>
                <button
                  type="button"
                  className="text-action"
                  onClick={resetDemo}
                  disabled={runtimeEnvironment === "production"}
                >
                  <RotateCcw aria-hidden="true" size={15} strokeWidth={1.8} />
                  {t("app.demo.reset")}
                </button>
              </div>
            ) : null}
            <p>{t("app.footer")}</p>
          </div>
        }
        navigationLabel={t("app.nav.primary")}
        navigationDensity="compact"
        mobileNavigationLabel={t("app.nav.open")}
        mobileNavigationTitle={t("app.nav.title")}
        mobileNavigationDescription={t("app.nav.description")}
        mainId="main-content"
        contentElement="div"
        contentOwnsTarget={false}
        className={`web-shell web-shell--${audience}`}
        onNavigate={(item, event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          router.push(item.href as Route);
        }}
      >
        <div className="shell-content">{children}</div>
      </StructuralAppShell>
    </div>
  );
}
