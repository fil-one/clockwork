"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

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

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: Omit<ButtonProps, "aria-label"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button
      className={`cw-icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
}
