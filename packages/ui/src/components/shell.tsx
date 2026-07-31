import type { ReactNode } from "react";

import { BrandSlot } from "./brand";

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  description?: string;
}

export interface NavigationGroup {
  id: string;
  label?: string;
  items: readonly NavigationItem[];
}

export function SkipLink({
  href = "#main-content",
  children = "Skip to main content",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a className="cw-skip-link" href={href}>
      {children}
    </a>
  );
}

export function Navigation({
  groups,
  label = "Primary",
}: {
  groups: readonly NavigationGroup[];
  label?: string;
}) {
  return (
    <nav className="cw-navigation" aria-label={label}>
      {groups.map((group) => (
        <section className="cw-navigation__group" key={group.id}>
          {group.label ? (
            <h2 className="cw-navigation__label">{group.label}</h2>
          ) : null}
          <ul className="cw-navigation__list">
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  className="cw-navigation__link"
                  href={item.disabled ? undefined : item.href}
                  aria-current={item.active ? "page" : undefined}
                  aria-disabled={item.disabled || undefined}
                  tabIndex={item.disabled ? -1 : undefined}
                >
                  {item.icon ? (
                    <span className="cw-navigation__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="cw-navigation__text">
                    <span>{item.label}</span>
                    {item.description ? (
                      <span className="cw-navigation__description">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {item.badge ? (
                    <span className="cw-navigation__badge">{item.badge}</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export interface AppShellProps {
  children: ReactNode;
  navigation: readonly NavigationGroup[];
  brand?: ReactNode;
  organization?: ReactNode;
  utilities?: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  navigationLabel?: string;
  mobileNavigationLabel?: string;
  mainId?: string;
  className?: string;
}

/** Responsive landmark structure. Product code owns routing and session behavior. */
export function AppShell({
  children,
  navigation,
  brand = <BrandSlot homeLink="/" descriptor="Commerce" />,
  organization,
  utilities,
  banner,
  footer,
  navigationLabel = "Primary",
  mobileNavigationLabel = "Navigation",
  mainId = "main-content",
  className = "",
}: AppShellProps) {
  const navigationContent = (
    <Navigation groups={navigation} label={navigationLabel} />
  );

  return (
    <div className={`cw-shell ${className}`.trim()}>
      <SkipLink href={`#${mainId}`} />
      <header className="cw-shell__header">
        <div className="cw-shell__brand">{brand}</div>
        <div className="cw-shell__organization">{organization}</div>
        <div className="cw-shell__utilities">{utilities}</div>
        <details className="cw-shell__mobile-navigation">
          <summary>{mobileNavigationLabel}</summary>
          <div className="cw-shell__mobile-panel">{navigationContent}</div>
        </details>
      </header>
      {banner ? <div className="cw-shell__banner">{banner}</div> : null}
      <aside className="cw-shell__rail">{navigationContent}</aside>
      <main className="cw-shell__main" id={mainId} tabIndex={-1}>
        {children}
      </main>
      {footer ? <footer className="cw-shell__footer">{footer}</footer> : null}
    </div>
  );
}

export function Breadcrumbs({
  items,
  label = "Breadcrumb",
}: {
  items: readonly { label: string; href?: string }[];
  label?: string;
}) {
  return (
    <nav className="cw-breadcrumbs" aria-label={label}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !current ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <span aria-current={current ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  metadata,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`cw-page-header ${className}`.trim()}>
      <div className="cw-page-header__copy">
        {eyebrow ? <p className="cw-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? (
          <div className="cw-page-header__description">{description}</div>
        ) : null}
        {metadata ? (
          <div className="cw-page-header__metadata">{metadata}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="cw-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}

export function Toolbar({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`cw-toolbar ${className}`.trim()}
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`cw-section ${className}`.trim()}>
      <header className="cw-section__header">
        <div>
          <h2>{title}</h2>
          {description ? <div>{description}</div> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
