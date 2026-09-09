import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aggregateConfiguration } from "@clockwork/workflows";

import {
  experienceAudiences,
  projectionChannels,
  type ExperienceAudience,
  type ProjectionChannel,
} from "@/src/features/experience-server/model";

/**
 * The binding between the (audience, channel) data layer and the route tree.
 *
 * `aggregateConfiguration` decides, per aggregate and audience, which channel a
 * projection row is written to. `app/(experience)` decides which paths exist.
 * Nothing has ever held the two together: every binding between them is a
 * hand-maintained string in a different file, which is how the `services`
 * channel came to have no detail route while `recordRoute` quietly answered the
 * list path for it.
 *
 * It is deliberately not a runtime registry: a registry would be one more
 * declaration to keep in step, and this repository has already been caught six
 * times shipping a declaration in place of an implementation. The only inputs
 * are the materializer's own configuration, the directories that exist, and the
 * channel arguments written in the source.
 *
 * ## Two separate bindings, because one name-shaped check is not two
 *
 * The first version of this file claimed a single comparison held both
 * directions. It did not, and the way it failed is worth keeping written down:
 * it inferred which channel a surface reads from the surface's *directory
 * name*. A directory named for a channel is a coincidence, not a binding.
 * Pointing `/internal/renewals` at `loadPortalRecords("internal", "renewals")`
 * -- a channel no aggregate ever writes for `internal`, and which that page's
 * own doc comment says "would return an empty page forever" -- left every
 * assertion here passing, because the directory is still called `renewals`
 * either way. So there are two tests now:
 *
 * 1. `classify` / `expected` below binds the route *tree* to the produced
 *    channels: a produced channel whose surface disappears moves to
 *    `unmounted`, a new directory named for an unproduced channel appears in
 *    `unbacked`, and a new directory named for nothing appears in
 *    `unchanneled`. All three move the computed object away from the literal.
 *    This is a check on names and directories only.
 * 2. `channelReads` binds the *code* to the produced channels: every literal
 *    `(audience, channel)` pair handed to a projection loader anywhere under
 *    `app/` or `src/` has to be a pair the materializer actually writes. This
 *    is the direction the name check cannot see, and its coverage boundary --
 *    the call sites whose channel is not a literal -- is asserted rather than
 *    assumed, so it cannot quietly widen.
 *
 * The expected sets below are literal on purpose. Several gaps are real and
 * belong to other lanes; weakening the assertion to accommodate them would
 * throw away the binding. Stating them instead means the test fails the moment
 * either side moves, including when one of the listed gaps is finally closed.
 */

/**
 * The jsdom environment gives `import.meta.url` no `file:` scheme, so the tree
 * is located from the working directory. Both candidates are checked because
 * the suite runs from the package and, through turbo, from the workspace root.
 * A root resolving to nothing would make every assertion vacuous, so a miss
 * throws.
 */
function locateExperienceRoot(): string {
  const candidates = [
    path.join(process.cwd(), "app", "(experience)"),
    path.join(process.cwd(), "apps", "web", "app", "(experience)"),
  ];
  for (const candidate of candidates)
    if (existsSync(path.join(candidate, "(customer)"))) return candidate;
  throw new Error(
    `Could not locate app/(experience) from ${process.cwd()}; the channel audit would pass without reading anything.`,
  );
}

const experienceRoot = locateExperienceRoot();

/**
 * Where each audience's surfaces are rooted, and the URL prefix that root
 * carries. Route groups -- `(customer)`, `(internal)`, `(partner)` -- are
 * spelled in the directory tree but not in the URL, which is why the prefix is
 * stated separately rather than derived from the path.
 */
const audienceRoots: Readonly<
  Record<ExperienceAudience, { directory: string; prefix: string }>
> = {
  customer: { directory: path.join(experienceRoot, "(customer)"), prefix: "" },
  partner: {
    directory: path.join(experienceRoot, "(partner)", "partner"),
    prefix: "/partner",
  },
  internal: {
    directory: path.join(experienceRoot, "(internal)", "internal"),
    prefix: "/internal",
  },
};

interface Surface {
  /** The URL the directory mounts, e.g. `/account/procurement`. */
  route: string;
  /** Its last static segment -- what a channel name would have to match. */
  segment: string;
}

/**
 * Every directory beneath an audience root that owns a `page.tsx`.
 *
 * Dynamic segments are skipped: `[id]` is a record within a channel's surface,
 * not a surface of its own. Nested route groups contribute no URL segment.
 */
function surfaces(directory: string, prefix: string): Surface[] {
  const found: Surface[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
    const child = path.join(directory, entry.name);
    const group = entry.name.startsWith("(");
    const route = group ? prefix : `${prefix}/${entry.name}`;
    if (!group && existsSync(path.join(child, "page.tsx")))
      found.push({ route, segment: entry.name });
    found.push(...surfaces(child, route));
  }
  return found;
}

function isChannel(value: string): value is ProjectionChannel {
  return (projectionChannels as readonly string[]).includes(value);
}

/** Channels the materializer writes rows to, for one audience. */
function producedChannels(audience: ExperienceAudience): string[] {
  const produced = new Set<string>();
  for (const configuration of Object.values(aggregateConfiguration)) {
    const channel = configuration[audience];
    if (channel) produced.add(channel);
  }
  return [...produced].sort();
}

interface Classification {
  /** Produced channels whose surface exists. */
  backed: string[];
  /** Produced channels with no surface: rows written that nothing reads. */
  unmounted: string[];
  /** Surfaces named for a channel this audience is never sent. */
  unbacked: string[];
  /**
   * Surfaces whose name is not a projection channel at all.
   *
   * Adding a surface here is a decision, not an accident. `/internal/migrations`
   * reads as an operator work queue and `migrations` is not a member of
   * `projectionChannels`, so nothing about its name could ever have failed --
   * which is the weakness of a name check, stated where it applies. If a new
   * surface genuinely reads its own source rather than a projection, add its
   * route to the audience's list below and say what it reads instead; if it
   * reads a projection, the `channel reads` suite is what checks the channel.
   */
  unchanneled: string[];
  /** Channels mounted by more than one surface. */
  ambiguous: string[];
}

function classify(audience: ExperienceAudience): Classification {
  const root = audienceRoots[audience];
  const produced = new Set(producedChannels(audience));
  const mounted = new Map<string, string[]>();
  const unchanneled: string[] = [];
  for (const surface of surfaces(root.directory, root.prefix)) {
    if (!isChannel(surface.segment)) {
      unchanneled.push(surface.route);
      continue;
    }
    mounted.set(surface.segment, [
      ...(mounted.get(surface.segment) ?? []),
      surface.route,
    ]);
  }
  const channels = [...mounted.keys()];
  return {
    backed: channels.filter((channel) => produced.has(channel)).sort(),
    unmounted: [...produced].filter((channel) => !mounted.has(channel)).sort(),
    unbacked: channels
      .filter((channel) => !produced.has(channel))
      .flatMap((channel) => mounted.get(channel) ?? [])
      .sort(),
    unchanneled: unchanneled.sort(),
    ambiguous: [...mounted]
      .filter(([, routes]) => routes.length > 1)
      .map(([channel, routes]) => `${channel}: ${routes.sort().join(", ")}`)
      .sort(),
  };
}

/**
 * The complete, current binding. Every entry that is not `backed` is a defect
 * or a deliberate exclusion, and each is named so it cannot drift silently.
 */
const expected: Readonly<Record<ExperienceAudience, Classification>> = {
  customer: {
    // The customer audience is whole: every channel the materializer writes
    // for it has one surface, and `services` is the one this stage added a
    // detail route for.
    backed: [
      "agreements",
      "amendments",
      "billing",
      "dashboard",
      "orders",
      "pocs",
      "quotes",
      "services",
    ],
    unmounted: [],
    // Four customer surfaces read a channel no aggregate ever writes to, so
    // each renders whatever its own empty state is, permanently.
    unbacked: [
      "/account/procurement",
      "/account/users",
      "/marketplace",
      "/support",
    ],
    unchanneled: [
      "/account",
      "/account/notifications",
      "/account/offboarding",
      "/agreements/execute",
      "/buy",
      // Direct approved-offer and durable customer request repository.
      "/buy/payg",
      "/orders/accept",
      "/quotes/new",
      "/states",
    ],
    ambiguous: [],
  },
  partner: {
    backed: ["billing", "commissions", "orders", "portfolio", "quotes"],
    // Four partner channels still have no dedicated mounted surface.
    unmounted: ["agreements", "amendments", "pocs", "services"],
    unbacked: [
      "/partner/brand",
      "/partner/disputes",
      "/partner/marketplace",
      "/partner/registrations",
      "/partner/renewals",
      "/partner/sandboxes",
      "/partner/support",
    ],
    unchanneled: ["/partner/enablement", "/partner/quotes/new"],
    ambiguous: [],
  },
  internal: {
    backed: [
      "agreements",
      "approvals",
      "collections",
      "provisioning",
      "queues",
      "reports",
    ],
    // "Unmounted" means no directory carries the channel's name. It does not
    // mean unread, and internally most of these are read: `orders` by
    // `/internal`, `/internal/collections`, `/internal/renewals` and
    // `/internal/search`; `dashboard` by `/internal/reports`,
    // `/internal/search` and `/internal/accounts/[id]`; `quotes` by
    // `/internal/search`. `amendments` and `pocs` are the two the second test
    // finds no reader for at all -- projected for operators and reachable from
    // nothing, which is a real gap and belongs to another lane.
    unmounted: ["amendments", "dashboard", "orders", "pocs", "quotes"],
    // `/internal/renewals` is named for a channel no aggregate writes to
    // internally, and the page says so itself. It reads the internal `orders`
    // and `collections` channels through `loadRenewalsWorkspace`, so the name
    // is the only thing about it that is unbacked. Nothing here can tell those
    // two situations apart; the second test is what checks that the channels it
    // actually reads exist.
    unbacked: ["/internal/renewals"],
    // `/internal/migrations` is the other half of that shape, and worse:
    // `migrations` is not a member of `projectionChannels` at all, so no
    // projection could back it even if the materializer were changed. The rest
    // are operator tools that read their own sources and claim no channel.
    //
    // `/internal/billing-reconciliation` reads `core_three_way_tie_out` and the
    // `reconciliation` exception queue; `/internal/unhandled-errors` reads the
    // durable runtime-failure audit events. Neither is a projection channel and
    // neither could be: the materializer writes no row for either. Revenue
    // reads reporting views, while status reads service status endpoints and
    // the two operator recovery readers; those are deliberately not channels.
    unchanneled: [
      "/internal/assisted",
      "/internal/billing-reconciliation",
      "/internal/capabilities",
      "/internal/catalog",
      "/internal/channel-policy",
      "/internal/gates",
      "/internal/migrations",
      "/internal/payg-offers",
      // Finance reads verified customer handoff requests directly.
      "/internal/payg-requests",
      "/internal/price-books",
      // Service-only operating-reference registry and bootstrap fallback.
      "/internal/providers",
      "/internal/recovery",
      "/internal/revenue",
      "/internal/search",
      "/internal/status",
      "/internal/unhandled-errors",
      "/internal/webhook-replay",
    ],
    ambiguous: [],
  },
};

describe("channel to surface binding", () => {
  it("reads a route tree, so the audit is not vacuous", () => {
    for (const audience of experienceAudiences) {
      const root = audienceRoots[audience];
      expect(
        surfaces(root.directory, root.prefix).length,
        `${audience} surfaces`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(experienceAudiences)(
    "produces only channels the %s portal type knows",
    (audience) => {
      const unknown = producedChannels(audience).filter(
        (channel) => !isChannel(channel),
      );
      expect(unknown).toEqual([]);
    },
  );

  /**
   * Names and directories, both ways -- and only names and directories. A
   * produced channel whose directory disappears moves from `backed` to
   * `unmounted`; a directory named for an unproduced channel appears in
   * `unbacked`; a directory named for no channel at all appears in
   * `unchanneled`. Each moves the computed object away from the literal above.
   *
   * It cannot see which channel a surface reads. A page that keeps its
   * directory name and changes its loader argument to a channel the
   * materializer never produces leaves this comparison identical. That is what
   * `channel reads` covers.
   */
  it.each(experienceAudiences)(
    "binds every %s channel name to exactly one mounted surface",
    (audience) => {
      expect(classify(audience)).toEqual(expected[audience]);
    },
  );

  it("mounts no channel on two surfaces", () => {
    for (const audience of experienceAudiences)
      expect(classify(audience).ambiguous, audience).toEqual([]);
  });
});

/**
 * The other binding: what the code asks for, rather than what the directories
 * are called.
 *
 * Every projection read in this application funnels through
 * `loadPortalRecords(audience, channel)`. `loadCommercialRecords`,
 * `loadCommercialRecord` and `loadCustomerCollectionRecords` are wrappers that
 * fix the audience to `customer`; `loadPartnerRecords` fixes it to `partner`.
 * So a string literal in the channel position of any of the five is a claim
 * that the materializer writes that channel for that audience, and the claim is
 * checkable without a registry: the argument is right there in the file.
 */
const webRoot = path.dirname(path.dirname(experienceRoot));

/**
 * `loadPortalRecords` and its wrappers, with the audience each one fixes.
 *
 * The scan is textual, not a parse: it does not distinguish a call from the
 * same text inside a comment or a string. That direction is safe -- a mention
 * can only add a read, never hide one -- and no mention exists today, since the
 * indirect set it produces is exactly the set of real call sites.
 */
const readers: Readonly<Record<string, ExperienceAudience | null>> = {
  loadPortalRecords: null,
  loadCommercialRecords: "customer",
  loadCommercialRecord: "customer",
  loadCustomerCollectionRecords: "customer",
  loadPartnerRecords: "partner",
};

/**
 * Where the readers are declared. Their own parameter lists are not reads, and
 * skipping the module is what keeps the declarations out of the indirect set.
 */
const readerModule = "src/features/experience-server/portal-view-loader.ts";

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      found.push(...sourceFiles(child));
      continue;
    }
    if (!/\.tsx?$/u.test(entry.name)) continue;
    if (/\.(test|stories)\.tsx?$/u.test(entry.name)) continue;
    found.push(child);
  }
  return found;
}

interface ChannelRead {
  /** Repo-relative to `apps/web`, in posix form so the assertion is portable. */
  file: string;
  audience: ExperienceAudience;
  channel: string;
}

interface ChannelReads {
  /** Reads whose audience and channel are both written as string literals. */
  literal: ChannelRead[];
  /**
   * Reads whose channel this scan cannot resolve, as `file (count)`.
   *
   * The count is there because the file name alone is not the boundary. A file
   * already listed for one dynamic read would otherwise absorb a second one
   * for free -- turning `loadPortalRecords("internal", "queues")` in
   * `queue-search/server-loader.ts` into a variable left a file-name-only
   * assertion passing, which is the same shape of hole this whole file exists
   * to close.
   */
  indirect: string[];
}

function scanChannelReads(): ChannelReads {
  const literal: ChannelRead[] = [];
  const indirect = new Map<string, number>();
  const files = [
    ...sourceFiles(path.join(webRoot, "app")),
    ...sourceFiles(path.join(webRoot, "src")),
  ];
  for (const file of files) {
    const relative = path.relative(webRoot, file).split(path.sep).join("/");
    if (relative === readerModule) continue;
    // Collapsed whitespace so a call broken across lines reads as one string.
    const source = readFileSync(file, "utf8").replace(/\s+/gu, " ");
    for (const [reader, fixedAudience] of Object.entries(readers)) {
      const calls = source.matchAll(new RegExp(`${reader}\\(([^)]*)`, "gu"));
      for (const call of calls) {
        const args = call[1] ?? "";
        const pair = fixedAudience
          ? /^\s*"(\w+)"/u.exec(args)
          : /^\s*"(\w+)"\s*,\s*"(\w+)"/u.exec(args);
        const audience = fixedAudience ?? pair?.[1];
        const channel = fixedAudience ? pair?.[1] : pair?.[2];
        if (!audience || !channel || !isAudience(audience)) {
          indirect.set(relative, (indirect.get(relative) ?? 0) + 1);
          continue;
        }
        literal.push({ file: relative, audience, channel });
      }
    }
  }
  return {
    literal,
    indirect: [...indirect].map(([file, count]) => `${file} (${count})`).sort(),
  };
}

function isAudience(value: string): value is ExperienceAudience {
  return (experienceAudiences as readonly string[]).includes(value);
}

const reads = scanChannelReads();

/**
 * Reads whose channel is a parameter or a computed value, so the literal scan
 * cannot resolve them. Stated rather than assumed: this is the exact coverage
 * boundary of the assertion below, and a new dynamic reader has to be added
 * here deliberately instead of silently escaping the check.
 *
 * - `partner-detail.tsx`, `partner-route.tsx` -- `loadPartnerRecords(surface)`
 *   where `surface` is a `PartnerSurfaceKey` prop. Every partner route passes a
 *   literal into those components, but the literal is a JSX attribute rather
 *   than a call argument, so it is not in scope here. The name check above
 *   covers the partner surfaces themselves.
 * - `projection-detail-page.tsx` -- `loadPortalRecords(audience, channel)` from
 *   props. Its two callers, `/internal/accounts/[id]` and
 *   `/internal/queues/[id]`, each also call `loadPortalRecords` directly with
 *   the same literal pair, so both pairs are checked below anyway.
 * - `internal-projection-page.tsx` -- same shape, and it currently has no
 *   caller at all.
 * - `dashboard-loader.ts` -- maps over a `readonly ProjectionChannel[]` built
 *   from its own per-audience configuration.
 * - `queue-search/server-loader.ts` -- maps over `keys(SEARCHABLE_CHANNELS)`.
 *   The same file's `loadQueueWorkspace` read is literal and is checked.
 */
const indirectReaders: readonly string[] = [
  "src/features/customer-partner/partner/partner-detail.tsx (1)",
  "src/features/customer-partner/partner/partner-route.tsx (1)",
  "src/features/experience-server/dashboard-loader.ts (1)",
  "src/features/experience-server/internal-projection-page.tsx (1)",
  "src/features/experience-server/projection-detail-page.tsx (1)",
  "src/features/internal-ops/queue-search/server-loader.ts (1)",
];

/**
 * Literal reads of a channel the materializer never writes for that audience.
 *
 * Six reads across five files, all customer, all asking for one of
 * `procurement`, `users`, `marketplace` or `support` -- four channels no
 * aggregate routes to `customer`, so every one of these reads returns nothing,
 * always. Four of the files are the surfaces the name check already lists as
 * `unbacked`; the fifth, `/account`, is the one the name check cannot see,
 * because it is named for no channel and reads two.
 *
 * They are stated rather than filtered out so the assertion stays strict:
 * closing one of these gaps fails this test, which is the intent.
 */
const knownUnwrittenReads: readonly string[] = [
  "app/(experience)/(customer)/account/page.tsx: customer/procurement",
  "app/(experience)/(customer)/account/page.tsx: customer/users",
  "app/(experience)/(customer)/account/procurement/page.tsx: customer/procurement",
  "app/(experience)/(customer)/account/users/page.tsx: customer/users",
  "app/(experience)/(customer)/marketplace/page.tsx: customer/marketplace",
  "app/(experience)/(customer)/support/page.tsx: customer/support",
];

describe("channel reads", () => {
  it("finds projection reads in the source, so the audit is not vacuous", () => {
    for (const audience of experienceAudiences)
      expect(
        reads.literal.filter((read) => read.audience === audience).length,
        `${audience} literal reads`,
      ).toBeGreaterThan(0);
    expect(reads.literal.length).toBeGreaterThan(20);
  });

  /**
   * The direction the directory names cannot hold. Point any surface's loader
   * at a channel the materializer never writes for its audience -- which is
   * what `/internal/renewals` would do if it read `renewals` instead of
   * `orders` -- and the pair appears here.
   */
  it("asks only for channels the materializer writes for that audience", () => {
    const produced = new Map(
      experienceAudiences.map((audience) => [
        audience,
        new Set(producedChannels(audience)),
      ]),
    );
    const unwritten = [
      ...new Set(
        reads.literal
          .filter((read) => !produced.get(read.audience)?.has(read.channel))
          .map((read) => `${read.file}: ${read.audience}/${read.channel}`),
      ),
    ].sort();
    expect(unwritten).toEqual([...knownUnwrittenReads].sort());
  });

  it("states every read whose channel it cannot resolve", () => {
    expect(reads.indirect).toEqual([...indirectReaders].sort());
  });
});
