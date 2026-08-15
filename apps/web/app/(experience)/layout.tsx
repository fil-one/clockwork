import type { ReactNode } from "react";

/**
 * The segment the experience group's fallbacks belong to.
 *
 * Next renders a segment's `error.tsx` and `not-found.tsx` inside that
 * segment's own layout. With no layout here, `(experience)/error.tsx` and
 * `(experience)/not-found.tsx` were children of the root document: reaching
 * either one replaced everything, including the audience shell that the
 * `(customer)`, `(partner)` and `(internal)` layouts render. This file makes
 * the group a real layout segment, so those two files are the group's
 * fallbacks rather than the application's.
 *
 * It adds no markup. The shell that survives a page failure comes from the
 * `error.tsx` and `not-found.tsx` in each audience group, which sit *below*
 * that group's layout and therefore render inside `AppShell`. This boundary
 * remains the one that catches what those cannot: a throw from an audience
 * layout itself -- the session read, the permission gate, the shell -- which
 * no boundary underneath it can see.
 */
export default function ExperienceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
