/**
 * Test-only replacement for Next's poisoned `server-only` marker.
 *
 * Vitest runs these modules in Node and jsdom rather than through Next's
 * condition-aware resolver. Keeping the alias in Vitest configuration lets
 * server modules be exercised without changing their production boundary.
 */
export {};
