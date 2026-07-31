"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button, StatusBadge } from "@clockwork/ui";

import { accounts } from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

import { navigation, type ExperienceAudience } from "./navigation";

function Wordmark({ audience }: { audience: ExperienceAudience }) {
  const href =
    audience === "partner"
      ? "/partner"
      : audience === "internal"
        ? "/internal"
        : "/dashboard";
  return (
    <Link
      className="wordmark"
      href={href}
      aria-label={`${t("app.name")} ${t("app.product")}`}
    >
      <span aria-hidden="true">FIL ONE</span>
      <small>{t("app.product")}</small>
    </Link>
  );
}

function OrganizationSwitcher({ audience }: { audience: ExperienceAudience }) {
  const [selected, setSelected] = useState<string>(
    audience === "partner"
      ? accounts[1].id
      : audience === "internal"
        ? accounts[2].id
        : accounts[0].id,
  );
  const selectId = useId();
  return (
    <label className="organization-switcher" htmlFor={selectId}>
      <span>{t("app.account.switch")}</span>
      <select
        id={selectId}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} · {account.role}
          </option>
        ))}
      </select>
    </label>
  );
}

function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      <Button
        variant="secondary"
        className="top-action"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span>{t("app.search")}</span>
        <kbd>⌘K</kbd>
      </Button>
      {open ? (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            className="command-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="command-title">{t("app.command")}</h2>
            <input
              ref={inputRef}
              className="command-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("app.search.hint")}
              aria-label={t("app.search")}
            />
            <nav aria-label={t("app.command")}>
              <Link href="/quotes/new" onClick={() => setOpen(false)}>
                {t("action.createQuote")}
              </Link>
              <Link
                href="/partner/registrations"
                onClick={() => setOpen(false)}
              >
                {t("action.register")}
              </Link>
              <Link href="/internal/search" onClick={() => setOpen(false)}>
                {t("nav.internal.search")}
              </Link>
              {query ? <p className="command-filter">{query}</p> : null}
            </nav>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("action.cancel")}
            </Button>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function AppShell({
  audience,
  children,
}: {
  audience: ExperienceAudience;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const runtimeEnvironment =
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? "local";

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

  const assisted =
    audience === "internal" && pathname.startsWith("/internal/assisted");
  const helpHref = audience === "partner" ? "/partner/support" : "/support";
  return (
    <div
      className="experience-shell"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <a className="skip-link" href="#main-content">
        {t("app.skip")}
      </a>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {!online ? (
        <div className="connection-banner" role="status">
          {t("app.offline")}
        </div>
      ) : null}
      {assisted ? (
        <div className="assisted-banner" role="status">
          <strong>{t("app.assisted")}</strong>
          <span>
            {t("app.assisted.description", {
              account: "Northstar Archive Labs",
            })}
          </span>
          <Link href="/internal">{t("app.assisted.exit")}</Link>
        </div>
      ) : null}
      <header className="shell-header">
        <Wordmark audience={audience} />
        <OrganizationSwitcher audience={audience} />
        <nav className="header-actions" aria-label={t("app.nav.secondary")}>
          <CommandMenu />
          <StatusBadge tone="warning">{t("app.demo.short")}</StatusBadge>
          <details className="utility-menu">
            <summary
              className="icon-action"
              aria-label={t("app.notifications.count")}
            >
              <span aria-hidden="true">●</span>
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
            aria-label={t("app.help")}
          >
            ?
          </Link>
          <details className="utility-menu">
            <summary className="avatar" aria-label={t("app.profile")}>
              MC
            </summary>
            <div className="utility-popover">
              <strong>{t("app.profile.name")}</strong>
              <p>{t("app.profile.role")}</p>
            </div>
          </details>
        </nav>
      </header>
      <div className="shell-body">
        <aside className="shell-sidebar">
          <nav aria-label={t("app.nav.primary")}>
            {navigation[audience].map((item) => {
              const active =
                item.href === "/partner" || item.href === "/internal"
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="nav-indicator" aria-hidden="true" />
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-meta">
            <StatusBadge tone="warning">{t("app.demo")}</StatusBadge>
            <button
              type="button"
              className="text-action"
              onClick={resetDemo}
              disabled={runtimeEnvironment === "production"}
            >
              {t("app.demo.reset")}
            </button>
            <p>{t("app.requestId", { id: "req_demo_8F4A" })}</p>
          </div>
        </aside>
        <div className="shell-content">{children}</div>
      </div>
      <footer className="shell-footer">{t("app.footer")}</footer>
    </div>
  );
}
