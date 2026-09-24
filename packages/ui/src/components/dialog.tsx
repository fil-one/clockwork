"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Button } from "./button";
import { kitWord, useKitText } from "./kit-text";

export interface DialogProps {
  title: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The close control's text. Without it the reader's word comes from `KitTextProvider`. */
  closeLabel?: string;
  footer?: ReactNode;
}
export function Dialog({
  title,
  description,
  trigger,
  children,
  defaultOpen,
  open,
  onOpenChange,
  closeLabel,
  footer,
}: DialogProps) {
  const close = kitWord(closeLabel, useKitText(), "close", "Dialog");
  return (
    <DialogPrimitive.Root
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
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
          <div className="cw-dialog-body">{children}</div>
          <div className="cw-dialog-footer">
            {footer}
            <DialogPrimitive.Close asChild>
              <Button variant="secondary">{close}</Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
