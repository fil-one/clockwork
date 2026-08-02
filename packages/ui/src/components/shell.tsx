"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import type {
  AnchorHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useState } from "react";

import { BrandSlot } from "./brand";
import { Tooltip } from "./tooltip";

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  description?: string;
  /** Optional product-owned side effect, such as telemetry. */
  onSelect?: () => void;
}

export interface NavigationGroup {
  id: string;
  label?: string;
  items: readonly NavigationItem[];
}

export interface NavigationProps {
  groups: readonly NavigationGroup[];
  label?: string;
  density?: "comfortable" | "compact";
  /** Runs after an enabled navigation link is activated. */
  onNavigate?: (
    item: NavigationItem,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void;
  /** Render a framework link. Spread every supplied link prop to retain semantics. */
  renderNavigationItem?: (
    item: NavigationItem,
    children: ReactNode,
    linkProps: AnchorHTMLAttributes<HTMLAnchorElement>,
  ) => ReactNode;
  className?: string;
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

/** Semantic grouped navigation shared by the rail and mobile drawer. */
export function Navigation({
  groups,
  label = "Primary",
  density = "comfortable",
  onNavigate,
  renderNavigationItem,
  className = "",
}: NavigationProps) {
  return (
    <nav
      className={`cw-navigation cw-navigation--${density} ${className}`.trim()}
      aria-label={label}
    >
      {groups.map((group) => (
        <section className="cw-navigation__group" key={group.id}>
          {group.label ? (
            <h2 className="cw-navigation__label">{group.label}</h2>
          ) : null}
          <ul className="cw-navigation__list">
            {group.items.map((item) => {
              const content = (
                <>
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
                </>
              );
              const linkProps: AnchorHTMLAttributes<HTMLAnchorElement> = {
                className: "cw-navigation__link",
                href: item.disabled ? undefined : item.href,
                "aria-current": item.active ? "page" : undefined,
                "aria-disabled": item.disabled || undefined,
                "aria-label":
                  density === "compact"
                    ? item.description
                      ? `${item.label}. ${item.description}`
                      : item.label
                    : undefined,
                tabIndex: item.disabled ? -1 : undefined,
                onClick: (event) => {
                  if (item.disabled) return;
                  item.onSelect?.();
                  onNavigate?.(item, event);
                },
              };
              const link = renderNavigationItem ? (
                renderNavigationItem(item, content, linkProps)
              ) : (
                <a {...linkProps}>{content}</a>
              );
              return (
                <li key={item.id}>
                  {/* The compact rail hides the label, so name it on hover and
                      on focus. Navigation stays the job of the first tap. */}
                  {density === "compact" ? (
                    <Tooltip side="right" revealOnTouch={false} trigger={link}>
                      {item.label}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export interface ResponsiveNavigationDrawerProps extends NavigationProps {
  triggerLabel?: string;
  title?: string;
  description?: string;
  closeLabel?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
}

/** Modal mobile navigation with focus trapping and focus restoration via Radix. */
export function ResponsiveNavigationDrawer({
  groups,
  label = "Primary",
  triggerLabel = "Open navigation",
  title = "Navigation",
  description = "Browse every destination.",
  closeLabel = "Close navigation",
  open,
  defaultOpen,
  onOpenChange,
  onNavigate,
  renderNavigationItem,
  trigger,
}: ResponsiveNavigationDrawerProps) {
  return (
    <DialogPrimitive.Root
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : (
        <Tooltip
          side="bottom"
          revealOnTouch={false}
          trigger={
            <DialogPrimitive.Trigger
              className="cw-shell__drawer-trigger"
              type="button"
              aria-label={triggerLabel}
            >
              <Menu aria-hidden="true" />
              <span>{title}</span>
            </DialogPrimitive.Trigger>
          }
        >
          {triggerLabel}
        </Tooltip>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cw-drawer-overlay" />
        <DialogPrimitive.Content
          className="cw-drawer-content"
          aria-modal="true"
        >
          <header className="cw-drawer-header">
            <div>
              <DialogPrimitive.Title className="cw-drawer-title">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="cw-drawer-description">
                {description}
              </DialogPrimitive.Description>
            </div>
            {/*
              No tooltip on this control. Radix arms Escape on the highest
              dismissable layer only, and the drawer autofocuses this button,
              which would open a tooltip layer above the dialog and leave the
              drawer unable to close on Escape. The tooltip would also only
              repeat the accessible name.
            */}
            <DialogPrimitive.Close
              className="cw-icon-button"
              type="button"
              aria-label={closeLabel}
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className="cw-drawer-body">
            <Navigation
              groups={groups}
              label={label}
              onNavigate={(item, event) => {
                onNavigate?.(item, event);
                onOpenChange?.(false);
              }}
              {...(renderNavigationItem ? { renderNavigationItem } : {})}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface AppShellProps {
  children: ReactNode;
  navigation: readonly NavigationGroup[];
  brand?: ReactNode;
  organization?: ReactNode;
  utilities?: ReactNode;
  banner?: ReactNode;
  bannerLabel?: string;
  footer?: ReactNode;
  skipLabel?: ReactNode;
  navigationLabel?: string;
  mobileNavigationLabel?: string;
  mobileNavigationTitle?: string;
  mobileNavigationDescription?: string;
  mobileNavigationCloseLabel?: string;
  navigationDensity?: "comfortable" | "compact";
  onNavigate?: NavigationProps["onNavigate"];
  renderNavigationItem?: NavigationProps["renderNavigationItem"];
  mainId?: string;
  contentElement?: "main" | "div";
  /** Set false when children provide the mainId target and main landmark. */
  contentOwnsTarget?: boolean;
  className?: string;
}

/**
 * Shared responsive application structure. Product code owns routing, session,
 * organization, command, and demo behavior through the supplied slots.
 */
export function AppShell({
  children,
  navigation,
  brand = <BrandSlot homeLink="/" descriptor="Commerce" />,
  organization,
  utilities,
  banner,
  bannerLabel = "Application status",
  footer,
  skipLabel,
  navigationLabel = "Primary",
  mobileNavigationLabel = "Open navigation",
  mobileNavigationTitle = "Navigation",
  mobileNavigationDescription = "Browse every destination.",
  mobileNavigationCloseLabel = "Close navigation",
  navigationDensity = "compact",
  onNavigate,
  renderNavigationItem,
  mainId = "main-content",
  contentElement = "main",
  contentOwnsTarget = true,
  className = "",
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const ContentElement = contentElement;

  return (
    <div className={`cw-shell ${className}`.trim()}>
      <SkipLink
        href={`#${mainId}`}
        {...(skipLabel === undefined ? {} : { children: skipLabel })}
      />
      <header className="cw-shell__header">
        <div className="cw-shell__brand">{brand}</div>
        <div className="cw-shell__organization">{organization}</div>
        <div className="cw-shell__utilities">{utilities}</div>
        <div className="cw-shell__mobile-navigation">
          <ResponsiveNavigationDrawer
            groups={navigation}
            label={navigationLabel}
            triggerLabel={mobileNavigationLabel}
            title={mobileNavigationTitle}
            description={mobileNavigationDescription}
            closeLabel={mobileNavigationCloseLabel}
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            onNavigate={(item, event) => {
              onNavigate?.(item, event);
              setMobileOpen(false);
            }}
            {...(renderNavigationItem ? { renderNavigationItem } : {})}
          />
        </div>
      </header>
      {banner ? (
        <section className="cw-shell__banner" aria-label={bannerLabel}>
          {banner}
        </section>
      ) : null}
      <aside className="cw-shell__rail">
        <Navigation
          groups={navigation}
          label={navigationLabel}
          density={navigationDensity}
          {...(onNavigate ? { onNavigate } : {})}
          {...(renderNavigationItem ? { renderNavigationItem } : {})}
        />
      </aside>
      <ContentElement
        className="cw-shell__main"
        id={contentOwnsTarget ? mainId : undefined}
        tabIndex={contentOwnsTarget ? -1 : undefined}
      >
        {children}
      </ContentElement>
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

export interface ToolbarProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Toolbar({ label, children, className = "" }: ToolbarProps) {
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

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({
  title,
  description,
  actions,
  children,
  className = "",
}: SectionProps) {
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
