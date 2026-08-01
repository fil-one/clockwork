# Experience and documents handoff

Current disposition: historical provenance. This lane and all documented
cross-lane joins are represented and repository-qualified on `main`; lane-local
limitations below do not describe current gaps or an RC/launch.

## Provenance

- Lane: Agent 4 — experience and documents
- Branch: `commerce/experience-docs`
- Foundation ancestry: verified with
  `git merge-base --is-ancestor commerce/foundation HEAD`
- Runtime used for verification: Node 24.18.1 and pnpm 10.34.5
- Lane boundaries: only `apps/web/**`, `packages/ui/**`,
  `packages/documents/**`, `packages/testing/src/{demo,personas,visual}/**`, and
  this handoff changed. Foundation API/webhook entrypoints, business state
  machines, schema, provider implementations, root manifests, generated
  artifacts, and the lockfile were not changed.

## Experience delivered

The authenticated experience uses three server-rendered route groups with
request-bound WorkOS sessions when configured and a deterministic local demo
session otherwise. Route and surface gates use the contract permission model,
including multiple roles in one session. The shell provides a skip link,
audience-aware wordmark and help destinations, organization switching, command
access, notification and profile menus, online/offline announcements, visible
demo state, production-safe demo reset, and an assisted-mode banner limited to
the assisted route.

The app includes designed loading, empty, partial, optimistic, success,
validation, permission, stale-version rollback, offline, recoverable, and fatal
states. Forms are keyboard-first and restore focus after recoverable failures.
All normal surface copy is drawn from the English message catalog; locale
registration makes Spanish an additive catalog. Money uses integer minor units
without lossy number conversion, and USD, EUR, GBP, dates, addresses, tax/VAT,
and plural forms are locale aware.

### Route inventory

| Audience | Routes                                                                                                                                                                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access   | `/`, `/choose-organization`, `/access/mfa`, `/access/session-expired`                                                                                                                                                                                                                                                                          |
| Customer | `/dashboard`, `/agreements`, `/agreements/execute`, `/quotes`, `/quotes/new`, `/quotes/[id]`, `/orders`, `/orders/[id]`, `/services`, `/amendments`, `/pocs`, `/billing`, `/account`, `/account/users`, `/account/procurement`, `/account/offboarding`, `/marketplace`, `/support`, `/states`                                                  |
| Partner  | `/partner`, `/partner/portfolio`, `/partner/portfolio/[id]`, `/partner/registrations`, `/partner/disputes`, `/partner/quotes`, `/partner/quotes/new`, `/partner/quotes/[id]`, `/partner/billing`, `/partner/commissions`, `/partner/renewals`, `/partner/sandboxes`, `/partner/brand`, `/partner/marketplace`, `/partner/support`              |
| Internal | `/internal`, `/internal/search`, `/internal/accounts/[id]`, `/internal/assisted`, `/internal/queues`, `/internal/queues/[id]`, `/internal/approvals`, `/internal/price-books`, `/internal/agreements`, `/internal/provisioning`, `/internal/collections`, `/internal/renewals`, `/internal/reports`, `/internal/migrations`, `/internal/gates` |
| Signing  | `/signing/redirect`, `/signing/embedded`, `/signing/return`                                                                                                                                                                                                                                                                                    |

Every authenticated commerce route is dynamically rendered so request auth is
not cached as static output. Detail routes resolve deterministic records and
show provenance, term state, documents, timeline, risk, and the next action.
Signing return accepts only the deterministic provider fixture envelope and
document hash; an unverified or altered return enters a recoverable failure
state.

## Design system and visual decisions

`@clockwork/ui` is a neutral, swappable Fil One system built from tokens rather
than a dashboard template. It uses an editorial cream field, near-black type,
deep archival green, sparing amber/red exception colors, strong whitespace, and
a text wordmark with an explicit replacement slot. Components include shell,
navigation, forms, dialog, tables, stat tiles, timelines, document cards, queue
rows, risk indicators, capacity and metric charts, skeleton/empty/error states,
and reduced-motion behavior.

The signature term bar shows elapsed service, notice window, end date, renewal
state, and remaining time in visual and screen-reader text. Compact, table, and
account-rollup variants are covered in tests and used by the web experience.
Charts are restrained and always have a semantic table equivalent. The
foundation claimed an existing Recharts dependency, but neither the root
manifest nor lockfile contains `recharts`, and lane rules prohibit changing
them. The committed accessible SVG chart primitive keeps the experience
functional; Agent 5 may replace its rendering internals with Recharts after
adding the shared dependency, without changing its public data shape.

Desktop customer, partner, and internal views and a 320 px customer view have
committed Playwright visual baselines. Manual inspection confirmed that the
mobile layout keeps the demo badge, key actions, term semantics, records,
charts, and activity readable without horizontal page overflow.

## Documents

`@clockwork/documents` renders deterministic branded PDFs for all 15 immutable
artifact kinds:

- direct, partner-transfer, and partner-priced resale/white-label quotes;
- order form and amendment;
- POC summary and final report;
- invoice companion and receipt;
- commission statement;
- renewal and decline confirmations;
- deletion certificate with retention exclusions; and
- reconciliation and general report exports.

Each page has a repeating header/footer, document ID, version, page number,
localized presentation, source-record SHA-256, verification URL, and accessible
document metadata. The renderer returns an immutable-byte SHA-256 and uses
canonical PDF object numbering so identical immutable input produces identical
bytes. Reports paginate in landscape; other artifacts paginate in portrait.
Golden data pins byte hash, byte length, and page count for every artifact.
Poppler inspection covered a 3-page direct quote, a partner-branded resale
quote, a 2-page deletion certificate, and the first, middle, and final pages of
a 12-page reconciliation report.

## Generated API contract and Agent 5 join

At this lane's foundation commit, the generated OpenAPI contract contains only:

- `GET /v1/core/status`
- `GET /v1/lifecycle/status`
- `GET /v1/system/status`
- `POST /v1/webhooks/workos`

The experience calls the generated client for the three status reads. MSW
handlers in `packages/testing/src/demo/handlers.ts` mirror those generated
responses exactly, including ready, latency, and network-offline cases. No
commerce payload or undocumented reset endpoint was invented. Rich experience
records remain deterministic read projections, and absent server mutations use
local optimistic demo behavior with validation and stale-version rollback.

Agent 5 should regenerate the client after merging the finance and lifecycle
lanes, then join the following operation families without moving business rules
into React:

| Experience  | Required generated operations                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell       | session organizations/accounts, notifications, global command/search                                                                                                                                       |
| Agreements  | list/detail, evidence, click-through/e-sign execution, customer paper, signed-document return                                                                                                              |
| Quotes      | direct and partner list/detail/create/revise/issue, approvals, immutable document download                                                                                                                 |
| Fulfillment | orders, services, amendments, purchase orders, provisioning status/re-drive                                                                                                                                |
| POC         | request, qualify, monitor caps/expiry, convert, summary/final document                                                                                                                                     |
| Billing     | invoices, receipts, payment method/intent, consolidated billing, disputes, collections                                                                                                                     |
| Account     | users/roles, procurement profile, offboarding, retention exclusions, deletion certificate                                                                                                                  |
| Partner     | agreement, end-client portfolio, registration/dispute, referral/resale/distributor paths, commissions/statements/clawbacks, renewals, sandboxes, branding/domain, marketplace/support reads                |
| Internal    | account timeline/search, assisted execution, queue assignment/resolution, approvals, price books, agreement templates, recovery, renewal command, reports/reconciliation, migration review, external gates |
| Documents   | artifact metadata, immutable version/hash, generated/download URL, provider signing envelope                                                                                                               |

Until those operations exist in the generated schema, unavailable immutable
downloads are visibly disabled instead of calling an alternate endpoint. On
join, replace only fixture adapters and optimistic callbacks; keep the route,
component, permission, and state contracts.

## Demo and persona coverage

The deterministic seed uses a fixed instant and coherent fictional accounts,
agreements, quotes, orders, POCs, invoices, queues, registrations, commissions,
renewals, marketplace records, support records, provisioning exceptions, and
reconciliation data. Nine role catalogs cover direct buyer, referral partner,
reseller, distributor, end client, billing user, legal approver, finance
approver, and internal operator.

Reset with one command:

```sh
pnpm exec tsx packages/testing/src/demo/reset-command.ts
```

The command accepts only the exact `demo` target internally and has no force
flag. Any production marker in `NODE_ENV`, `VERCEL_ENV`, `CLOCKWORK_ENV`,
`DEPLOYMENT_ENVIRONMENT`, or `ENVIRONMENT` refuses the reset. The visible shell
reset clears only `clockwork-demo:` browser keys and is also disabled when the
public runtime environment is production.

## Verification evidence

All commands ran from the experience worktree with Node 24:

| Check                   | Result                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting              | `pnpm format` and `pnpm format:check` passed                                                                                                                                                   |
| Lint and boundaries     | ESLint passed with zero warnings; 284 modules/441 dependencies, zero violations                                                                                                                |
| Typecheck               | 10/10 workspace packages passed                                                                                                                                                                |
| Unit                    | 91 tests passed, including 29 UI, 27 demo/persona/visual, 14 web, and 7 document tests                                                                                                         |
| Integration/doc goldens | 19 tests passed; 15 PDF kinds rendered and golden hashes matched                                                                                                                               |
| Storybook/a11y          | 3/3 tests passed with no axe findings; production Storybook build passed                                                                                                                       |
| Playwright              | 17/17 passed: nine role-backed persona/axe journeys, a permission-denial journey, quote validation and recovery, signing return, smoke/API mount, three desktop visuals, and one 320 px visual |
| Production build        | 10/10 packages passed; Next compiled and generated 54 route entries                                                                                                                            |
| Generated contract      | regeneration produced no diff                                                                                                                                                                  |
| Security                | secret scan passed; dependency audit reported no high/critical issues (two moderate advisories remain in the foundation dependency graph)                                                      |
| Demo safety             | reset passed in demo; production-marked invocation refused with exit code 1                                                                                                                    |

## External gates

- `EXT-BRAND-01` remains high: approved logo assets, licensed fonts, palette,
  legal entity, and footer copy must replace the neutral text-mark brand config.
  Repeat desktop/mobile and PDF accessibility review after replacement.
- `EXT-LEGAL-01` controls final agreement templates, notice/retention language,
  partner survival terms, and signing thresholds.
- `EXT-COMMERCIAL-01` controls production SKU/price books, floors, tiers, and
  claims wording. Fixtures are deliberately fictional USD/EUR/GBP values.
- `EXT-PROVIDER-01`, `EXT-ACC-01`, and `EXT-DOMAIN-01` control production
  e-sign, email/support feeds, credentials, callbacks, and custom domains.
  Current provider/loading/failure/return views are deterministic simulators.
- `EXT-TAX-01` must approve the US/ES/UK invoice and VAT/reverse-charge matrix.
- `EXT-PROVISION-01` is required for live usage, entitlement, confirmation, and
  safe re-drive data.
- `EXT-APPROVERS-01` must replace fictional primary/backup queue owners and
  response targets.
- `EXT-TEARDOWN-01` keeps automated destructive teardown disabled; the UI shows
  the two-person and retention-exclusion safe path only.
