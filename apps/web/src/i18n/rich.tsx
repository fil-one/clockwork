import { Fragment, type ReactNode } from "react";

import type { MessageId, Translator } from "./catalogs";

const open = "\u0000";

/**
 * A message whose placeholders include React elements: "Read {time}" with a
 * `<time>`, "Contact {link}" with a `<Link>`. The sentence stays one message,
 * so the translator decides where the element goes; never split it into a
 * translated prefix and suffix around the element.
 *
 * Strings and numbers are passed to the translator as usual (including the
 * right-to-left isolation it applies); elements are put back in place.
 */
export function richText(
  t: Translator,
  id: MessageId,
  values: Readonly<Record<string, ReactNode>>,
): ReactNode {
  const plain: Record<string, string | number> = {};
  const elements = new Map<string, ReactNode>();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number")
      plain[key] = value;
    else {
      plain[key] = `${open}${key}${open}`;
      elements.set(key, value);
    }
  }
  const parts = t(id, plain).split(
    new RegExp(`${open}([^${open}]*)${open}`, "u"),
  );
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <Fragment key={index}>{elements.get(part)}</Fragment>
    ) : (
      part
    ),
  );
}
