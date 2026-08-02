import type { ReactNode } from "react";

/**
 * A breadcrumb trail holds no state, so this module carries no "use client"
 * directive. That matters: the detail surfaces that render it are server
 * components, and a server component cannot hand a `renderLink` function to a
 * client one.
 */
export function Breadcrumbs({
  items,
  label = "Breadcrumb",
  renderLink,
}: {
  items: readonly { label: string; href?: string }[];
  label?: string;
  /**
   * Render a framework link for a crumb that has an href. A crumb carries no
   * state beyond its label and target, so this receives the href directly
   * rather than an attribute bag.
   */
  renderLink?: (href: string, label: string) => ReactNode;
}) {
  return (
    <nav className="cw-breadcrumbs" aria-label={label}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !current ? (
                renderLink ? (
                  renderLink(item.href, item.label)
                ) : (
                  <a href={item.href}>{item.label}</a>
                )
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
