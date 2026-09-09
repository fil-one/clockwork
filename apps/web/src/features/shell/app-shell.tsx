"use client";
import { useTranslations } from "@/src/i18n/client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  AppShell as StructuralAppShell,
  ArrowLeftRight,
  BadgeDollarSign,
  BookOpen,
  BrandLogo,
  Building2,
  Button,
  ChevronDown,
  CircleHelp,
  CommandPalette,
  FileDiff,
  FileText,
  FlaskConical,
  Handshake,
  Inbox,
  Layers,
  LayoutDashboard,
  PackageCheck,
  Paintbrush,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ScrollText,
  Settings,
  ShoppingCart,
  ShieldCheck,
  TriangleAlert,
  SlidersHorizontal,
  Stamp,
  StatusBadge,
  Tooltip,
  Users,
  WalletCards,
  Webhook,
  ChartNoAxesCombined,
  type CommandPaletteItem,
  type NavigationGroup,
} from "@clockwork/ui";

import { switchCommerceAccount } from "@/src/auth/actions";
import { signOutCommerceSession } from "@/src/auth/sign-out";
import { type MessageId } from "@/src/i18n/en";

import { brandAsset } from "./brand-assets";
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
  "/buy/payg": <ReceiptText size={19} strokeWidth={1.8} />,
  "/buy": <ShoppingCart size={19} strokeWidth={1.8} />,
  "/agreements": <FileText size={19} strokeWidth={1.8} />,
  "/quotes": <ScrollText size={19} strokeWidth={1.8} />,
  "/orders": <PackageCheck size={19} strokeWidth={1.8} />,
  "/services": <Layers size={19} strokeWidth={1.8} />,
  "/pocs": <FlaskConical size={19} strokeWidth={1.8} />,
  "/billing": <ReceiptText size={19} strokeWidth={1.8} />,
  "/amendments": <FileDiff size={19} strokeWidth={1.8} />,
  "/marketplace": <Building2 size={19} strokeWidth={1.8} />,
  "/support": <CircleHelp size={19} strokeWidth={1.8} />,
  "/account": <Settings size={19} strokeWidth={1.8} />,
  "/partner": <LayoutDashboard size={19} strokeWidth={1.8} />,
  "/partner/portfolio": <Users size={19} strokeWidth={1.8} />,
  "/partner/registrations": <Handshake size={19} strokeWidth={1.8} />,
  "/partner/quotes": <ScrollText size={19} strokeWidth={1.8} />,
  "/partner/orders": <ScrollText size={19} strokeWidth={1.8} />,
  "/partner/billing": <ReceiptText size={19} strokeWidth={1.8} />,
  "/partner/commissions": <BadgeDollarSign size={19} strokeWidth={1.8} />,
  "/partner/renewals": <RefreshCw size={19} strokeWidth={1.8} />,
  "/partner/disputes": <Scale size={19} strokeWidth={1.8} />,
  "/partner/marketplace": <Building2 size={19} strokeWidth={1.8} />,
  "/partner/sandboxes": <SlidersHorizontal size={19} strokeWidth={1.8} />,
  "/partner/brand": <Paintbrush size={19} strokeWidth={1.8} />,
  "/partner/enablement": <BookOpen size={19} strokeWidth={1.8} />,
  "/partner/support": <CircleHelp size={19} strokeWidth={1.8} />,
  "/internal": <LayoutDashboard size={19} strokeWidth={1.8} />,
  "/internal/search": <Search size={19} strokeWidth={1.8} />,
  "/internal/queues": <Inbox size={19} strokeWidth={1.8} />,
  "/internal/renewals": <RefreshCw size={19} strokeWidth={1.8} />,
  "/internal/collections": <ReceiptText size={19} strokeWidth={1.8} />,
  "/internal/provisioning": <PackageCheck size={19} strokeWidth={1.8} />,
  "/internal/recovery": <RotateCcw size={19} strokeWidth={1.8} />,
  "/internal/webhook-replay": <Webhook size={19} strokeWidth={1.8} />,
  "/internal/migrations": <ArrowLeftRight size={19} strokeWidth={1.8} />,
  "/internal/reports": <ChartNoAxesCombined size={19} strokeWidth={1.8} />,
  "/internal/revenue": <BadgeDollarSign size={19} strokeWidth={1.8} />,
  "/internal/billing-reconciliation": <Scale size={19} strokeWidth={1.8} />,
  "/internal/status": <RefreshCw size={19} strokeWidth={1.8} />,
  "/internal/unhandled-errors": <TriangleAlert size={19} strokeWidth={1.8} />,
  "/internal/agreements": <FileText size={19} strokeWidth={1.8} />,
  "/internal/approvals": <Stamp size={19} strokeWidth={1.8} />,
  "/internal/price-books": <WalletCards size={19} strokeWidth={1.8} />,
  "/internal/payg-requests": <Inbox size={19} strokeWidth={1.8} />,
  "/internal/payg-offers": <ReceiptText size={19} strokeWidth={1.8} />,
  "/internal/providers": <Layers size={19} strokeWidth={1.8} />,
  "/internal/catalog": <Layers size={19} strokeWidth={1.8} />,
  "/internal/channel-policy": <Handshake size={19} strokeWidth={1.8} />,
  "/internal/capabilities": <SlidersHorizontal size={19} strokeWidth={1.8} />,
  "/internal/gates": <ShieldCheck size={19} strokeWidth={1.8} />,
  "/internal/assisted": <Users size={19} strokeWidth={1.8} />,
};

interface NavigationSection {
  id: string;
  label?: MessageId;
  hrefs: readonly string[];
}

/**
 * Rail sections. Fifteen internal destinations do not scan as one list, so each
 * portal declares its sections here and the rail orders items by section rather
 * than by the flat list in `navigation`. The leading section carries no label:
 * the home destination and the tools that reach every record need no heading.
 * A section whose members are all filtered out by role is dropped.
 */
const navigationSections: Readonly<
  Record<ExperienceAudience, readonly NavigationSection[]>
> = {
  customer: [
    { id: "desk", hrefs: ["/dashboard"] },
    {
      id: "pricing",
      label: "nav.group.pricing",
      hrefs: ["/buy", "/buy/payg", "/quotes", "/pocs", "/marketplace"],
    },
    {
      id: "legal",
      label: "nav.group.legal",
      hrefs: ["/agreements", "/amendments"],
    },
    {
      id: "service",
      label: "nav.group.service",
      hrefs: ["/orders", "/services", "/support"],
    },
    {
      id: "organization",
      label: "nav.group.organization",
      hrefs: ["/billing", "/account"],
    },
  ],
  partner: [
    { id: "desk", hrefs: ["/partner", "/partner/portfolio"] },
    {
      id: "deal-flow",
      label: "nav.group.partner.dealFlow",
      hrefs: [
        "/partner/registrations",
        "/partner/quotes",
        "/partner/orders",
        "/partner/sandboxes",
        "/partner/marketplace",
      ],
    },
    {
      id: "revenue",
      label: "nav.group.partner.revenue",
      hrefs: [
        "/partner/billing",
        "/partner/commissions",
        "/partner/renewals",
        "/partner/disputes",
      ],
    },
    {
      id: "channel",
      label: "nav.group.partner.channel",
      hrefs: ["/partner/brand", "/partner/enablement", "/partner/support"],
    },
  ],
  internal: [
    {
      id: "desk",
      hrefs: ["/internal", "/internal/search", "/internal/assisted"],
    },
    {
      id: "queues",
      label: "nav.group.internal.queues",
      hrefs: [
        "/internal/queues",
        "/internal/approvals",
        "/internal/payg-requests",
        "/internal/collections",
        "/internal/renewals",
      ],
    },
    {
      id: "provider-recovery",
      label: "nav.group.internal.providerRecovery",
      hrefs: [
        "/internal/provisioning",
        "/internal/recovery",
        "/internal/webhook-replay",
        "/internal/status",
        "/internal/unhandled-errors",
        "/internal/gates",
      ],
    },
    {
      id: "administration",
      label: "nav.group.internal.administration",
      hrefs: [
        "/internal/agreements",
        "/internal/price-books",
        "/internal/payg-offers",
        "/internal/providers",
        "/internal/catalog",
        "/internal/channel-policy",
        "/internal/capabilities",
        "/internal/migrations",
        "/internal/reports",
        "/internal/revenue",
        "/internal/billing-reconciliation",
      ],
    },
  ],
};

/**
 * The mark is decorative; the link carries the accessible name. `BrandLogo`
 * falls back to the text wordmark if the asset does not resolve.
 */
function Wordmark({ audience }: { audience: ExperienceAudience }) {
  const t = useTranslations();
  return (
    <Link
      className="wordmark"
      href={audienceHome[audience]}
      aria-label={`${t("app.name")} ${t("app.product")}`}
    >
      <BrandLogo src={brandAsset()} name={t("app.name")} />
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
  const t = useTranslations();
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
  const t = useTranslations();
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
  const [profileOpen, setProfileOpen] = useState(false);
  const profilePopoverId = useId();
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node))
        setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
      profileTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

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
            aria-label={t("app.command")}
          >
            <Search aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{t("app.search")}</span>
            <kbd aria-hidden="true">⌘/Ctrl K</kbd>
            <span className="sr-only">{t("app.command.shortcut")}</span>
          </Button>
        }
      />
      {!providerBacked ? (
        <StatusBadge tone="warning">{t("app.demo.short")}</StatusBadge>
      ) : null}
      <Tooltip
        side="bottom"
        revealOnTouch={false}
        trigger={
          <Link className="icon-action" href={helpHref} aria-label={helpLabel}>
            <CircleHelp aria-hidden="true" size={19} strokeWidth={1.8} />
          </Link>
        }
      >
        {helpDescription}
      </Tooltip>
      <div className="utility-menu" ref={profileMenuRef}>
        <button
          type="button"
          className="avatar"
          ref={profileTriggerRef}
          aria-label={t("app.profile")}
          title={t("app.profile")}
          aria-expanded={profileOpen}
          aria-controls={profilePopoverId}
          onClick={() => setProfileOpen((open) => !open)}
        >
          {initials || "U"}
        </button>
        <div
          className="utility-popover"
          id={profilePopoverId}
          hidden={!profileOpen}
        >
          <p>
            <Link href="/settings">{t("settings.title")}</Link>
          </p>
          <strong>
            <bdi>{profile.name}</bdi>
          </strong>
          <p>
            <bdi>{profile.email}</bdi>
          </p>
          {providerBacked && audience === "internal" && (
            <p>
              <Link href="/access/mfa">{t("app.verifyAuthentication")}</Link>
            </p>
          )}
          <form action={signOutCommerceSession}>
            <Button type="submit" variant="secondary" size="small">
              {t("app.signOut")}
            </Button>
          </form>
        </div>
      </div>
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
  const t = useTranslations();
  const roles = session.roles;
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const commandItems = useMemo(
    () =>
      getCommandItems(
        audience,
        roles,
        {
          providerBacked: session.providerBacked,
        },
        t,
      ),
    [audience, roles, session.providerBacked, t],
  );
  const navigationGroups = useMemo<readonly NavigationGroup[]>(() => {
    const remaining = new Map(
      navigation[audience]
        .filter((item) => canAccessNavigationItem(item, roles))
        .map((item) => [
          item.href as string,
          {
            id: item.href,
            href: item.href,
            label: t(item.label),
            icon: navigationIcons[item.href],
            active: isNavigationItemActive(item, pathname),
          },
        ]),
    );
    const sections = navigationSections[audience].map((section) => {
      const items = section.hrefs.flatMap((href) => {
        const item = remaining.get(href);
        if (!item) return [];
        remaining.delete(href);
        return [item];
      });
      return {
        id: `${audience}-${section.id}`,
        ...(section.label ? { label: t(section.label) } : {}),
        items,
      };
    });
    // A destination added to `navigation` but not to a section still has to
    // reach the rail, so anything left over trails the declared sections.
    if (remaining.size > 0) {
      sections.push({
        id: `${audience}-more`,
        items: [...remaining.values()],
      });
    }
    return sections.filter((section) => section.items.length > 0);
  }, [audience, pathname, roles, t]);

  /**
   * A client transition replaces the content of the page without a document
   * load, so nothing tells a screen reader user that the route changed: the
   * framework calls `focus()` on the new segment, but a landmark is not
   * focusable and the call is a no-op, and no live region carried the
   * destination. The shell already owns one polite region for connection and
   * organization messages, so the route name goes through that region rather
   * than a second one competing with it.
   *
   * Focus is deliberately left where it is. Controls here restore focus on
   * purpose after a navigation -- the mobile drawer hands it back to its
   * trigger -- and moving it into the content region would take it away from
   * them. The skip link is the supported way to jump into the content, and it
   * now moves focus for real.
   */
  const destination = useMemo(
    () =>
      navigationGroups
        .flatMap((group) => group.items)
        .find((item) => item.active)?.label ?? null,
    [navigationGroups],
  );
  const announcedPath = useRef<string | null>(null);
  useEffect(() => {
    if (announcedPath.current === null) {
      // The first render is the document load. The browser announces that.
      announcedPath.current = pathname;
      return;
    }
    if (announcedPath.current === pathname) return;
    announcedPath.current = pathname;
    const heading = document
      .querySelector("#main-content h1")
      ?.textContent?.trim();
    setAnnouncement(
      t("app.pageLoaded", { page: heading || destination || pathname }),
    );
  }, [destination, pathname, t]);

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
  }, [t]);

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
        /*
         * The rail renders framework links so moving between surfaces is a
         * client transition against a prefetched route rather than a document
         * load. A plain anchor would rebuild the shell, the session header and
         * the command palette on every click. A disabled item has no href, so
         * it stays a plain anchor and keeps its aria-disabled semantics.
         */
        renderNavigationItem={(item, content, linkProps) => {
          const { href, ...rest } = linkProps;
          // A disabled item has no href, so it stays a plain anchor.
          if (!href) return <a {...linkProps}>{content}</a>;
          // The rest of the bag is anchor attributes, which `Link` accepts at
          // runtime. The assertion only satisfies exactOptionalPropertyTypes,
          // which treats an explicitly undefined handler as different from an
          // absent one.
          return (
            <Link
              {...(rest as Omit<ComponentProps<typeof Link>, "href">)}
              href={href as Route}
            >
              {content}
            </Link>
          );
        }}
        skipLabel={t("app.skip")}
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
            <p>{t("app.footer")}</p>
          </div>
        }
        navigationLabel={t("app.nav.primary")}
        navigationDensity="comfortable"
        mobileNavigationLabel={t("app.nav.open")}
        mobileNavigationTitle={t("app.nav.title")}
        mobileNavigationDescription={t("app.nav.description")}
        mobileNavigationCloseLabel={t("app.nav.close")}
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
