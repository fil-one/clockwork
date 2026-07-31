"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Button } from "./button";

export interface DialogProps {
  title: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}
export function Dialog({
  title,
  description,
  trigger,
  children,
  defaultOpen,
}: DialogProps) {
  return (
    <DialogPrimitive.Root
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
    >
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cw-dialog-overlay" />
        <DialogPrimitive.Content className="cw-dialog-content">
          <DialogPrimitive.Title className="cw-dialog-title">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="cw-dialog-description">
            {description}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close asChild>
            <Button variant="secondary">Close</Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
