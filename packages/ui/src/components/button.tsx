"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Tooltip } from "./tooltip";
import type { TooltipSide } from "./tooltip";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "small" | "medium" | "large";
  loading?: boolean;
  loadingLabel?: ReactNode;
}

export function Button({
  className = "",
  variant = "primary",
  size = "medium",
  loading = false,
  loadingLabel,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`cw-button cw-button--${variant} cw-button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="cw-button__progress" aria-hidden="true" />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * The label names the button for assistive technology and shows on hover, on
 * keyboard focus, and on the first tap. The tooltip repeats the name and adds
 * nothing else, so no fact lives only here.
 */
export function IconButton({
  label,
  children,
  className = "",
  tooltipSide = "bottom",
  ...props
}: Omit<ButtonProps, "aria-label"> & {
  label: string;
  children: ReactNode;
  tooltipSide?: TooltipSide;
}) {
  return (
    <Tooltip
      side={tooltipSide}
      revealOnTouch={false}
      trigger={
        <Button
          className={`cw-icon-button ${className}`.trim()}
          aria-label={label}
          {...props}
        >
          <span aria-hidden="true">{children}</span>
        </Button>
      }
    >
      {label}
    </Tooltip>
  );
}
