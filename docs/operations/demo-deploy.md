# Deploying the demo site

The public demo runs at https://clockwork-commerce-demo.netlify.app. It deploys
directly from a local checkout with the Netlify CLI. The site is not linked to
the GitHub repository and has no webhooks: pushing to `main` does not deploy
anything, and that is the intended setup, not a break. Do not "fix" it by wiring
up continuous deployment.

## Order of operations

Git first, always, then deploy. Every change reaches the live demo by this route
and no other:

1. Commit the work.
2. Push the branch and open a pull request.
3. Merge to `main`, so `main` is the whole truth.
4. Check out `main`, pull it, and deploy from there with the command below.

The demo is never deployed from a branch, a dirty tree, or a checkout behind
`main`. Because the site has no GitHub link, nothing enforces this: a deploy
takes whatever is on disk, so a shortcut here puts code on the public sales site
that exists in no commit and that nobody can review or roll back to.

Run the deploy after any update that changes what a prospect sees. Merging alone
changes nothing on the live site.

## The deploy command

From the repository root, on `main`, with a clean tree:

```sh
CI=1 NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:?set NETLIFY_AUTH_TOKEN}" \
  pnpm exec netlify deploy --build --prod \
  --site e6b53765-8195-4fd4-b1c9-48a5ca8ef0b7 \
  --filter @clockwork/web
```

What each piece does:

- `--build` runs the `netlify.toml` build
  (`pnpm exec turbo run build --filter=@clockwork/web` plus
  `@netlify/plugin-nextjs`) locally, with the site's environment variables
  injected. Deploying a bare local `.next` without this misses both the plugin
  packaging and the demo env gates.
- `--site` is the site ID for `clockwork-commerce-demo` (Netlify account
  `james-cr5mtao`).
- `--filter @clockwork/web` selects the web app in the monorepo. Without it the
  CLI stops on an interactive project picker; `CI=1` suppresses the rest of the
  prompts.
- The Netlify CLI invocation, Next.js build plugin, Node, and pnpm versions are
  pinned in this command, `package.json`, `netlify.toml`, and the root toolchain
  files. Use the checked-in command; do not substitute an unpinned
  `npx ...@latest` invocation.
- The token is a Netlify personal access token supplied through the process
  environment only; it is never written to this repository or a local `.env`. If
  it stops working, create a new one at Netlify → User settings → Applications →
  Personal access tokens.

## Environment

All demo configuration lives on the Netlify site (Site configuration →
Environment variables), scoped to builds, functions, and runtime:
`CLOCKWORK_DEMO_DEPLOY`, `NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY`,
`CLOCKWORK_EXPERIENCE_ADAPTER`, `CLOCKWORK_EVIDENCE_ADAPTER`,
`CLOCKWORK_DEMO_ACCESS_PASSWORD`, `CLOCKWORK_DEMO_STATE_STORE`,
`NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV`, `NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS`,
`CLOCKWORK_CANONICAL_ORIGIN`, `CLOCKWORK_ENV`, `OTEL_SDK_DISABLED`,
`TAX_PROVIDER_BASE_URL`, `TAX_PROVIDER_TOKEN`.

The last two are `EXT-TAX-01` and are unset on the demo, deliberately. **What
that now means changed, and the old description is worth stating so nobody
restores it from memory.** Determination used to run through a provider port,
and an unset port refused `orders:create` and `invoices:create` outright so that
neither could issue a document with a zero in `tax_minor`. Determination is now
made by the engine in `@clockwork/domain` from `core_tax_rule_books` and
`core_tax_registrations`, and the port is read by nothing.

The guarantee survived the move and got stronger. A missing rule book is a
refusal that cannot be mistaken for a zero rate, whereas an optional port is
absent in production and silently zero everywhere else. Rates are versioned data
an authority supplies, never literals in shipped code, so `EXT-TAX-01` still
names a real external input — the approved policy — rather than a piece of
wiring. The two variables can stay unset indefinitely without a zero-tax
document becoming possible.

The demo determines tax in-process, over a seeded rule book, through the
**same** `determineTax` engine the product runs. The numbers on a demo document
are computed, not mocked.

None of these belong in a committed file or a local `.env`. The demo access
password in particular must stay out of `.env`, because `next dev` would load it
and turn the password gate on for every local Playwright run.

## Deploy a draft first

Run the same command **without `--prod`**. It prints a unique draft URL. Verify
there before promoting, because the checks below have each caught something the
font-class check cannot see.

**The draft shares demo state with production.** The Netlify Blobs store is
site-wide, not deploy-scoped, so mutations and "Restore demo data" on a draft
hit the same state the live site serves. Fine for fixture data, but reset
deliberately when you are done rather than leaving a prospect's next visit
holding your test order.

## Verifying a deploy

```sh
curl -s https://clockwork-commerce-demo.netlify.app/demo/access | grep -o '<html[^>]*'
```

A current build carries the three font variable classes (`aspekta_…`,
`funnelsans_…`, `funneldisplay_…`) on the `<html>` tag. Then sign in as any
persona and sign out; it should land on the persona picker, not an error card.

That check proves the build is current and the shell renders. It does not prove
the demo still demonstrates anything, so walk these too — each corresponds to
something that has actually broken here:

1. **Wrong password** is refused, and the return path survives the retry.
2. **Every persona** starts and lands on its own surface.
3. **The guided journey deep links** from the demo panel all resolve. Two of
   them silently stopped resolving once, and the panel is the first thing a
   salesperson clicks.
4. **A document downloads as a real PDF.** All 19 artifact kinds returned 503
   for a while on a swallowed `TypeError`, and the fix is bundler configuration
   whose file tracing is exactly the environment-sensitive part — local success
   does not imply packaged success.
5. **Quote → order acceptance completes**, past the order form and onto a
   created order. This was a permanent dead end before it was fixed; it is the
   flagship journey. Run the reproducible path, not an arbitrary acceptable
   quote:

   1. From `/demo`, choose **Start as Mara Voss**. She lands on `/dashboard`.
      Open **Demo controls** and follow **Review the issued version and proceed
      to acceptance.** to `/quotes/quote-direct-renewal-v2`.
   2. Confirm the record says **Annual renewal · committed capacity** and
      **Issued · awaiting acceptance**. Choose **Review and accept order**. The
      destination must be `/orders/accept?quote=quote-direct-renewal-v2`, and
      its promise chain must name **Accepted quote Q-2026-0312 · version 2**;
      the route key and projection-row version are not the commercial quote
      identity.
   3. Enter **Purchase order** `PO-DEMO-0312`, **Service start** `2027-01-01`,
      **Service end** `2027-12-31`, and **Authority title**
      `Operations Director`. Check the confirmation that names both ends of the
      service term, then choose **Accept order and create commitment**.
   4. Wait for **Open the order form**. Open it and verify the response is a
      real PDF (`application/pdf`, beginning `%PDF-`) that carries the entered
      PO and service term. Then choose **Create the order and commitment**.
   5. Confirm **Order created. Its commitment and provisioning state are now
      authoritative.**, follow **Open the created order**, and verify the
      resulting record says **Committed capacity · PO-DEMO-0312** and **Active ·
      accepted in this session**. Reopen `/quotes/quote-direct-renewal-v2`: it
      must now say **Accepted · order created** and must not offer **Review and
      accept order** again.
   6. Use **Restore demo data** and confirm **Reset demo**. The created-order
      route must become unavailable after reload. This cleanup is mandatory on
      draft and production because both deploys share the site's Blob state.

6. **Finance can author and activate a price book.** As Mateo Silva, create a
   draft, add its first rate card, propose activation, and use the seeded
   independent proposal to exercise the second-authority activation decision.
   The new and activated versions must remain visible after refresh.
7. **Queue refresh changes the page.** As Ada Mercer, open `/internal/queues`,
   choose **Refresh data**, and confirm the stale warning and refresh button
   disappear. This is a secured persisted refresh, not a page reload.
8. **Partner work persists.** As Priya Nair, register a deal, create a priced
   partner quote, and request a renewal. Each result must appear in its
   collection and remain after a fresh page read.
9. **Customer settings persist.** As Mara Voss, change a notification choice,
   reload the page, and confirm the stored choice remains. Account, member, and
   procurement updates follow the same resettable demo-state boundary.
10. **Sandbox payment completes without moving money.** As Theo Grant, open the
    overdue invoice, acknowledge the demo-only payment boundary, complete the
    sandbox checkout, and return to a visibly paid invoice with its demo
    receipt. The real Stripe session path must never run in the demo.
11. **"Sign this agreement"** reaches the ceremony and returns. This depends on
    `NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS` containing the site's **own** origin —
    the ceremony URL is same-origin and the client refuses any signing URL
    outside that list. Being `NEXT_PUBLIC`, it is baked at build time, so
    correcting it requires a rebuild, not just an environment change.
12. **The devtools console** carries at most the Zod `eval` line, which is
    cosmetic and documented in `apps/web/proxy.ts`. Anything mentioning
    `script-src-elem` means the vendored Next patch in `patches/` was dropped —
    see `patches/README.md`. Repeated `/api/telemetry` 403s mean no ingest
    secret is set; harmless, fail-closed, but noisy for a technical prospect.

One environment trap: `CLOCKWORK_DEMO_STATE_STORE=memory` breaks order
acceptance in a production build, because the API route and the page bundles get
separate module instances and the created order never reaches the ledger. The
file store and `netlify-blobs` are both fine, and the site uses the latter.

## Before you deploy at all

Build once locally from the merged `main`. A state has been observed where the
web build failed on a package it depends on, and "a deploy takes whatever is on
disk" is a live hazard, not a theoretical one.

One naming trap: `commerce-demo.netlify.app` is a different, unrelated site that
is not in this account. The demo is `clockwork-commerce-demo`.
