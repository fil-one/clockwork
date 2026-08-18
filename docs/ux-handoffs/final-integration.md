# UX final integration handoff

Current disposition: historical provenance. The complete UX history and later
authoritative joins were considered represented and repository-qualified when
this handoff was written; the current backlog controls present status.

## Provenance and merge order

Integration was completed on `ux/integration` from the common setup baseline
`821697c9863342ed2eedc4341eb444000562e5dd`. Each lane contained one committed
change and no root dependency or lockfile edits.

| Order | Branch                | Integrated commit                          |
| ----- | --------------------- | ------------------------------------------ |
| 1     | `ux/design-shell`     | `d8589e816bbd62233bd5fcbce345afec929252c6` |
| 2     | `ux/customer-partner` | `041e65de2864e5e24a131c2c7ba88e6cd13618b5` |
| 3     | `ux/internal-ops`     | `30ad76a8bb2118b2605358da1694d3aa54464eef` |

The design-shell lane remains authoritative for `packages/ui/**`, the shared
shell, navigation, command palette, tokens, and shell-related global CSS.
Customer/partner and internal feature ownership remains within their route and
feature directories. No API, authorization, audit, payment, provider, retention,
database, workflow, root-manifest, or lockfile contract was changed.

## Integration decisions

- All three audience layouts now pass server-derived roles into the finalized
  shared `AppShell`. Navigation and command items are filtered by permission or
  explicit role before rendering, so neither the desktop rail, mobile drawer,
  nor command search advertises unauthorized work.
- The shared navigation inventory now exposes every permitted customer, partner,
  and internal destination. The mobile drawer uses the same filtered inventory,
  including marketplace, support, brand, sandbox, provisioning, migration, gate,
  approval, and assisted-work routes.
- Production organization choices are constrained to the active session-audience
  roles. Deterministic local persona switching remains available only for the
  demo experience.
- The duplicate shell-level assisted-mode banner was removed. The assisted route
  owns the single prominent banner containing effective account, immutable staff
  actor, reason, and exit review. Actions without a backed command are presented
  as secure-workflow handoffs rather than inert mutation controls.
- Customer and partner collections retain the canonical URL vocabulary: `q`,
  `status`, `risk`, `owner`, `sort`, `view`, `page`, and `pageSize`. Filter
  changes create browser-history entries, reload from the URL, and preserve
  unrelated valid state.
- Quote, agreement, order, resale, renewal, payment, and offboarding journeys
  keep their review boundary. Retry attempts reuse their generated identifiers,
  timestamps, idempotency key, and payload. Successful actions cannot be
  submitted twice.
- Customer-facing selectors and review summaries lead with names. Canonical
  identifiers and hashes remain available in technical disclosures and payloads.
- Payment handoff keeps invoice amount and provider-confirmed payment status
  separate. Estimate labels remain distinct from invoice and reconciliation
  truth.
- Partner seller navigation, commands, dashboard metrics, and actions exclude
  finance/admin-only content. Internal search links resolve only to
  internal-safe destinations.
- The forest/parchment shell tokens remain the visual source of truth. Feature
  surfaces were aligned to those tokens, 44 px interaction targets, visible
  focus, bounded data-table scrolling, wrapped 320 px term labels, tabular
  numerals, and reduced-motion behavior.

## Shared abstractions

The shared shell, navigation, command palette, application-state panels, term
bar, buttons, and responsive structural primitives are used where their
contracts align. Task-specific commercial selectors, operational review cards,
and collection controls remain feature-local where they encode a different value
contract, validation/focus behavior, evidence model, or domain-specific review.
In particular, replacing label-to-canonical-ID selectors with a generic
ID-valued combobox would obscure the payload boundary, so that abstraction was
not forced during integration.

## Validation

Validation used pnpm 10.34.5 and Node 24.11.1 unless noted. CI is already pinned
to Node 24.18.1; the document check was also reproduced with that exact runtime.

| Command or suite                                          | Result                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                       | Pass                                                                                                                                                                       |
| `pnpm lint`                                               | Pass, zero warnings                                                                                                                                                        |
| `pnpm boundaries`                                         | Pass, 651 modules and 1,714 dependencies with zero violations                                                                                                              |
| `pnpm typecheck`                                          | Pass, 10/10 packages                                                                                                                                                       |
| `pnpm test:unit`                                          | Pass, 10/10 packages; web 107 tests and UI 34 tests                                                                                                                        |
| Customer/partner focused unit suite                       | Pass, 35/35                                                                                                                                                                |
| Internal-operations focused unit suite                    | Pass, 28/28                                                                                                                                                                |
| `pnpm test:storybook`                                     | Pass, 5/5 with Axe coverage                                                                                                                                                |
| `pnpm build:storybook`                                    | Pass                                                                                                                                                                       |
| `pnpm build`                                              | Pass, 10/10 packages and 55 Next route entries                                                                                                                             |
| `pnpm test:e2e:smoke`                                     | Pass, 1/1                                                                                                                                                                  |
| Full `pnpm test:e2e`                                      | Pass, 64/64                                                                                                                                                                |
| UX shell Playwright                                       | Pass, 14/14                                                                                                                                                                |
| Customer/partner Playwright                               | Pass, 16/16                                                                                                                                                                |
| Internal-operations Playwright                            | Pass, 14/14                                                                                                                                                                |
| Visual regression                                         | Pass, 4/4 at the existing `0.01` maximum diff ratio                                                                                                                        |
| Representative customer, partner, and internal Axe checks | Pass                                                                                                                                                                       |
| `pnpm db:reset`                                           | Pass; canonical local migrations and seed applied                                                                                                                          |
| `pnpm db:test`                                            | Blocked outside the UX diff: 10 of 169 pgTAP assertions fail in existing seeded RLS/commercial-chain fixtures                                                              |
| `pnpm test:integration`                                   | Blocked outside the UX diff: the repository DB role lacks `INSERT` on `core_collection_cases`; committed PDF byte goldens differ on macOS even under exact CI Node 24.18.1 |

No failed assertion was weakened. The four web visual baselines were inspected
before update and retained the existing tolerance. PDF goldens were not updated:
all 15 untouched renders are byte-stable within a run, retain their page counts
and metadata, but produce platform-different byte lengths and SHA-256 values on
this macOS environment.

The local database was reset before its documented gates were rerun. The pgTAP
failures include seeded primary-key collisions, resale RLS visibility,
marketplace/order-chain fixtures, and one distributor-chain fixture. The
collections repository integration failure remains the exact PostgreSQL
permission error after reset. These areas predate and are outside the UX-owned
diff; changing their grants, RLS, seed, finance, or chain behavior here would
violate integration authority.

## Visual and interaction review

The customer dashboard, quote builder, customer quote detail, partner desk,
partner portfolio, internal operations home, exception queue, and
report/reconciliation view were exercised at `1440x1000`, `1024x768`,
`768x1024`, `390x844`, and `320x800`. Automated full-page overflow, navigation,
focus, and interaction checks cover all five sizes. Current full-page captures
were manually inspected at 1440 and 320 pixels for each priority surface.

The integrated result has no document-level horizontal overflow at 320 pixels;
dense report data scrolls only inside a labelled bounded region. All authorized
destinations remain reachable through the mobile drawer. Primary targets are
approximately 44 px, focus stays visible, drawer focus is trapped and restored,
and reduced-motion preferences remove nonessential motion.

## External brand and activation gates

`EXT-BRAND-01` remains in `review` and is a high-severity blocker for
public-facing polish sign-off. Approved logos, licensed fonts, final palette,
claims-approved copy, legal entity, and document/footer content are not present.
The neutral text mark and swappable tokens remain intentionally in place. After
brand replacement, customer, partner, white-label, internal, mobile, and
print/PDF output require renewed visual and WCAG AA/Axe review.

The other existing external gates remain fail-closed and were not presented as
active: production accounts/credentials, legal templates, commercial inputs,
provider selection, provisioning, tax/accounting, domains, approver rosters,
marketplace enrollment, migration authority, and automated teardown. UI review
states and contextual handoffs preserve those gates without implying that a
visible environment variable or local simulator proves production readiness.
