"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Tooltip } from "./tooltip";

export type CommandPaletteCategory = "navigation" | "actions" | "records";

export interface CommandPaletteItem {
  id: string;
  label: string;
  category: CommandPaletteCategory;
  description?: string;
  keywords?: readonly string[];
  audiences?: readonly string[];
  href?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface CommandPaletteProps {
  items: readonly CommandPaletteItem[];
  audience?: string;
  trigger?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Product-owned routing hook. When omitted, href items use location.assign. */
  onSelect?: (item: CommandPaletteItem) => void;
  title?: string;
  description?: string;
  triggerLabel?: string;
  closeLabel?: string;
  searchLabel?: string;
  placeholder?: string;
  noResultsLabel?: string;
  groupLabels?: Partial<Record<CommandPaletteCategory, string>>;
  shortcut?: boolean;
}

const categoryOrder: readonly CommandPaletteCategory[] = [
  "navigation",
  "actions",
  "records",
];

function matches(item: CommandPaletteItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [item.label, item.description, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalized);
}

/** Audience-filtered command menu with complete keyboard and modal behavior. */
export function CommandPalette({
  items,
  audience,
  trigger,
  open,
  defaultOpen = false,
  onOpenChange,
  onSelect,
  title = "Search and commands",
  description = "Search navigation, common actions, and records.",
  triggerLabel = "Search and commands",
  closeLabel = "Close command palette",
  searchLabel = "Search navigation, actions, and records",
  placeholder = "Search navigation, actions, and records",
  noResultsLabel = "No matching commands. Try a different search.",
  groupLabels,
  shortcut = true,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `commands-${useId().replaceAll(":", "")}`;
  const controlled = open !== undefined;
  const resolvedOpen = open ?? internalOpen;

  const setOpen = (next: boolean) => {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setQuery("");
      setActiveId(undefined);
    }
  };

  const results = useMemo(
    () =>
      items.filter(
        (item) =>
          (!item.audiences || !audience || item.audiences.includes(audience)) &&
          matches(item, query),
      ),
    [audience, items, query],
  );
  const selectable = results.filter((item) => !item.disabled);
  const currentIndex = selectable.findIndex((item) => item.id === activeId);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!resolvedOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resolvedOpen, shortcut]);

  useEffect(() => {
    if (!resolvedOpen) return;
    if (!selectable.some((item) => item.id === activeId)) {
      setActiveId(selectable[0]?.id);
    }
  }, [activeId, resolvedOpen, selectable]);

  const select = (item: CommandPaletteItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect?.();
    onSelect?.(item);
    if (
      !item.onSelect &&
      !onSelect &&
      item.href &&
      typeof window !== "undefined"
    ) {
      window.location.assign(item.href);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!selectable.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const start = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const next = (start + direction + selectable.length) % selectable.length;
      setActiveId(selectable[next]?.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        selectable.find((item) => item.id === activeId) ?? selectable[0];
      if (selected) select(selected);
    }
  };

  const labels: Record<CommandPaletteCategory, string> = {
    navigation: groupLabels?.navigation ?? "Navigation",
    actions: groupLabels?.actions ?? "Actions",
    records: groupLabels?.records ?? "Records",
  };

  return (
    <DialogPrimitive.Root open={resolvedOpen} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        {trigger ?? (
          <button
            className="cw-command-trigger"
            type="button"
            aria-label={triggerLabel}
          >
            <Search aria-hidden="true" />
            <span>{triggerLabel}</span>
            <kbd aria-hidden="true">⌘K</kbd>
          </button>
        )}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cw-command-overlay" />
        <DialogPrimitive.Content
          className="cw-command-content"
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <header className="cw-command-header">
            <div>
              <DialogPrimitive.Title className="cw-command-title">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="cw-sr-only">
                {description}
              </DialogPrimitive.Description>
            </div>
            <Tooltip
              side="bottom"
              revealOnTouch={false}
              trigger={
                <DialogPrimitive.Close
                  className="cw-icon-button"
                  type="button"
                  aria-label={closeLabel}
                >
                  <X aria-hidden="true" />
                </DialogPrimitive.Close>
              }
            >
              {closeLabel}
            </Tooltip>
          </header>
          <div className="cw-command-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label={searchLabel}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                activeId ? `${listId}-${activeId}` : undefined
              }
              autoComplete="off"
              value={query}
              placeholder={placeholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
          </div>
          <div
            className="cw-command-results"
            id={listId}
            role={results.length ? "listbox" : undefined}
          >
            {results.length ? (
              categoryOrder.map((category) => {
                const categoryItems = results.filter(
                  (item) => item.category === category,
                );
                if (!categoryItems.length) return null;
                const headingId = `${listId}-${category}-heading`;
                return (
                  <section
                    className="cw-command-group"
                    key={category}
                    role="group"
                    aria-labelledby={headingId}
                  >
                    <h3 id={headingId}>{labels[category]}</h3>
                    {categoryItems.map((item) => (
                      <button
                        className="cw-command-result"
                        id={`${listId}-${item.id}`}
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={activeId === item.id}
                        disabled={item.disabled}
                        tabIndex={-1}
                        onClick={() => select(item)}
                        onPointerMove={() => {
                          if (!item.disabled) setActiveId(item.id);
                        }}
                      >
                        {item.icon ? (
                          <span
                            className="cw-command-result__icon"
                            aria-hidden="true"
                          >
                            {item.icon}
                          </span>
                        ) : null}
                        <span className="cw-command-result__copy">
                          <strong>{item.label}</strong>
                          {item.description ? (
                            <span>{item.description}</span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })
            ) : (
              <div className="cw-command-empty" role="status">
                <Search aria-hidden="true" />
                <strong>No results</strong>
                <span>{noResultsLabel}</span>
              </div>
            )}
          </div>
          <footer className="cw-command-footer" aria-hidden="true">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Move
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>Esc</kbd> Close
            </span>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
