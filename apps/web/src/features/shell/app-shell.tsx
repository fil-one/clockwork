"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  AppShell as StructuralAppShell,
  Bell,
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

import { accounts } from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

import { getCommandItems } from "./command-items";
import {
  canAccessNavigationItem,
  isNavigationItemActive,
  navigation,
  roleCanAccess,
  type ExperienceAudience,
} from "./navigation";

const audienceHome: Readonly<Record<ExperienceAudience, Route>> = {
  customer: "/dashboard",
  partner: "/partner",
  internal: "/internal",
};

const audienceAccount: Readonly<Record<ExperienceAudience, string>> = {
  customer: accounts[0].id,
  partner: accounts[1].id,
  internal: accounts[2].id,
};

const accountDestination = new Map<string, Route>([
  [accounts[0].id, audienceHome.customer],
  [accounts[1].id, audienceHome.partner],
  [accounts[2].id, audienceHome.internal],
]);

const accountAudience = new Map<string, ExperienceAudience>([
  [accounts[0].id, "customer"],
  [accounts[1].id, "partner"],
  [accounts[2].id, "internal"],
]);

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
  audience,
  availableAccounts,
  announce,
}: {
  audience: ExperienceAudience;
  availableAccounts: readonly (typeof accounts)[number][];
  announce: (message: string) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(audienceAccount[audience]);
  const selectId = useId();

  useEffect(() => setSelected(audienceAccount[audience]), [audience]);

  const changeOrganization = (accountId: string) => {
    const account = availableAccounts.find(
      (candidate) => candidate.id === accountId,
    );
    const destination = accountDestination.get(accountId);
    if (!account || !destination) return;

    setSelected(accountId);
    announce(t("app.account.switched", { account: account.name }));
    router.push(destination);
  };

  return (
    <label className="organization-switcher" htmlFor={selectId}>
      <span>{t("app.account.switch")}</span>
      <span className="organization-switcher__control">
        <Building2 aria-hidden="true" size={17} strokeWidth={1.8} />
        <select
          id={selectId}
          value={selected}
          onChange={(event) => changeOrganization(event.target.value)}
        >
          {availableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
    </label>
  );
}

function ShellUtilities({
  audience,
  commandItems,
}: {
  audience: ExperienceAudience;
  commandItems: readonly CommandPaletteItem[];
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
      <StatusBadge tone="warning">{t("app.demo.short")}</StatusBadge>
      <details className="utility-menu">
        <summary
          className="icon-action"
          aria-label={t("app.notifications.count")}
          title={t("app.notifications")}
        >
          <Bell aria-hidden="true" size={19} strokeWidth={1.8} />
          <span className="notification-indicator" aria-hidden="true" />
        </summary>
        <div className="utility-popover">
          <strong>{t("app.notifications")}</strong>
          <ul>
            <li>{t("app.notifications.renewal")}</li>
            <li>{t("app.notifications.invoice")}</li>
            <li>{t("app.notifications.poc")}</li>
          </ul>
        </div>
      </details>
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
          MC
        </summary>
        <div className="utility-popover">
          <strong>{t("app.profile.name")}</strong>
          <p>{t("app.profile.role")}</p>
        </div>
      </details>
    </nav>
  );
}

export function AppShell({
  audience,
  roles,
  children,
}: {
  audience: ExperienceAudience;
  roles: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const runtimeEnvironment =
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? "local";
  const availableAccounts =
    runtimeEnvironment === "production"
      ? accounts.filter((account) => {
          const accountPortal = accountAudience.get(account.id);
          return (
            accountPortal !== undefined &&
            roles.some((role) => roleCanAccess(accountPortal, role))
          );
        })
      : accounts;

  const commandItems = useMemo(
    () => getCommandItems(audience, roles),
    [audience, roles],
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
          <OrganizationSwitcher
            audience={audience}
            availableAccounts={availableAccounts}
            announce={setAnnouncement}
          />
        }
        utilities={
          <ShellUtilities audience={audience} commandItems={commandItems} />
        }
        banner={banner}
        footer={
          <div className="shell-footer-content">
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
              <span>{t("app.requestId", { id: "req_demo_8F4A" })}</span>
            </div>
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
