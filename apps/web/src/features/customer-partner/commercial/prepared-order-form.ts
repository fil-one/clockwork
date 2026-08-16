/**
 * The contract between the acceptance surface and the server read that tells it
 * whether the order form it is waiting on exists yet.
 *
 * It lives in its own module, carrying types and nothing else, because the two
 * ends cannot import each other: the reader is a `"use client"` component and
 * the answer comes from a `"use server"` action over a `server-only` loader.
 *
 * Every member is a *terminal* answer to one question -- "may the create pass
 * run now?" -- and only `stored` says yes. That is the whole point of the
 * union: a poll that treats "no answer yet" and "this deployment cannot
 * answer" as the same thing either strands the reader on a spinner or tells
 * them to keep waiting for something that is never coming.
 */
export type PreparedOrderFormLookup =
  /**
   * The renderer has stored the form and bound it to the order that was named.
   *
   * `documentId` is what the create pass quotes; `artifactId` is what the
   * reader opens. They are different identifiers and both are needed: the
   * binding is checked against the document, but the artifact download route is
   * keyed on the request that produced it (`experience_artifact_deliveries.id`
   * falling through to `core_commercial_artifact_requests.id`), so a link built
   * from `documentId` resolves to nothing. Before `artifactId` travelled with
   * the answer, the surface could tell the reader their order form existed and
   * could not show it to them.
   */
  | { status: "stored"; documentId: string; artifactId: string }
  /** The request exists and the renderer has not finished. Keep waiting. */
  | { status: "pending" }
  /**
   * This deployment cannot answer: no authoritative database is composed, or
   * the portal is running on demo data. Nothing is in flight, and waiting
   * longer changes nothing.
   */
  | { status: "unavailable" }
  /** The session no longer holds the permission the acceptance needs. */
  | { status: "forbidden" };

/** Asks the server whether the order form for `orderId` has been stored. */
export type LookupPreparedOrderForm = (
  orderId: string,
) => Promise<PreparedOrderFormLookup>;
