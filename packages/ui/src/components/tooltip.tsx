"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import { useRef, useState } from "react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";

/**
 * A tooltip carries supporting detail. A fact the reader needs to finish the
 * task, and the consequence of a destructive action, must also be in the
 * visible copy of the surface.
 */
export type TooltipSide = "top" | "right" | "bottom" | "left";

const OPEN_DELAY_MS = 180;

/**
 * Radix opens a tooltip on hover and on keyboard focus and dismisses it on
 * Escape. A touch tap reaches neither path, so the first tap opens the tooltip
 * and holds back the trigger's default action, and the second tap closes it and
 * lets the trigger act. Hover and keyboard behaviour is unchanged.
 */
function useTouchReveal(open: boolean, setOpen: (open: boolean) => void) {
  const openRef = useRef(open);
  openRef.current = open;
  const revealingRef = useRef(false);

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      revealingRef.current = event.pointerType === "touch" && !openRef.current;
      if (!revealingRef.current) return;
      event.preventDefault();
      setOpen(true);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!revealingRef.current) return;
      revealingRef.current = false;
      event.preventDefault();
    },
  };
}

function TipContent({
  side,
  children,
}: {
  side: TooltipSide;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className="cw-tooltip"
        side={side}
        sideOffset={8}
        collisionPadding={8}
      >
        {children}
        <TooltipPrimitive.Arrow className="cw-tooltip__arrow" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface TooltipProps {
  trigger: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  defaultOpen?: boolean;
  /**
   * Set false when the trigger owns the tap: a dialog trigger, a close button,
   * anything whose own handler must run on the first touch. The reveal handler
   * calls preventDefault, and a Radix primitive composed underneath skips its
   * own handler once the default is prevented. Hover, keyboard focus, and
   * Escape are unaffected either way.
   */
  revealOnTouch?: boolean;
}
export function Tooltip({
  trigger,
  children,
  side = "top",
  defaultOpen = false,
  revealOnTouch = true,
}: TooltipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const touchReveal = useTouchReveal(open, setOpen);
  return (
    <TooltipPrimitive.Provider delayDuration={OPEN_DELAY_MS}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger
          asChild
          {...(revealOnTouch ? touchReveal : {})}
        >
          {trigger}
        </TooltipPrimitive.Trigger>
        <TipContent side={side}>{children}</TipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export interface InfoTipProps {
  label: string;
  children: ReactNode;
  side?: TooltipSide;
  defaultOpen?: boolean;
}
export function InfoTip({
  label,
  children,
  side = "top",
  defaultOpen = false,
}: InfoTipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const touchReveal = useTouchReveal(open, setOpen);
  return (
    <TooltipPrimitive.Provider delayDuration={OPEN_DELAY_MS}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger
          type="button"
          className="cw-infotip"
          aria-label={label}
          {...touchReveal}
        >
          <CircleHelp aria-hidden="true" />
        </TooltipPrimitive.Trigger>
        <TipContent side={side}>{children}</TipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
