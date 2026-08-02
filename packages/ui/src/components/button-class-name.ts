export interface ButtonClassNameOptions {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "small" | "medium" | "large";
  className?: string;
}

/**
 * The button class string, for the elements that cannot be a `<button>`: a
 * link, an anchor, a form control. Omitting `size` omits the size modifier,
 * which is what those call sites want.
 *
 * This module carries no "use client" directive so that server components can
 * call it. The string builder holds no state and touches no browser API.
 */
export function buttonClassName({
  variant = "primary",
  size,
  className = "",
}: ButtonClassNameOptions = {}): string {
  const sizeClass = size ? ` cw-button--${size}` : "";
  return `cw-button cw-button--${variant}${sizeClass} ${className}`.trim();
}
