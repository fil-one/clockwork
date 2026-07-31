"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import type { ReactNode } from "react";

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      <ToastPrimitive.Viewport className="cw-toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
export function Toast({
  open,
  onOpenChange,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <ToastPrimitive.Root
      className="cw-toast"
      open={open}
      onOpenChange={onOpenChange}
    >
      <ToastPrimitive.Title>
        <strong>{title}</strong>
      </ToastPrimitive.Title>
      {description ? (
        <ToastPrimitive.Description>{description}</ToastPrimitive.Description>
      ) : null}
    </ToastPrimitive.Root>
  );
}
