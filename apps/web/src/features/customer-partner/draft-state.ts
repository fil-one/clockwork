/**
 * Whether a draft still holds only what it was opened with.
 *
 * Shallow by construction: every builder draft in this feature is a flat record
 * of strings, and a deep comparison would invite one that is not. Compared
 * against the same factory the builder seeded its state from, so a default the
 * reader never touched -- `us-east`, `direct`, a 90-day protection window, the
 * expiry derived from the clock the form was opened at -- does not count as
 * work, and re-typing a value back to its default un-counts it again.
 */
export function draftIsDirty<T extends object>(draft: T, pristine: T): boolean {
  return (Object.keys(pristine) as (keyof T)[]).some(
    (key) => draft[key] !== pristine[key],
  );
}

/** Whether any of these free-text entries holds something. */
export function anyEntered(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}
