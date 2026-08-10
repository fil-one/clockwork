# Handoff: Netlify deploy, branch cleanup, open items

Written 2 Aug 2026. Everything in git is landed; the only blocked item is the
Netlify deploy, which needs account access this session did not have.

> **Correction, later on 2 Aug 2026.** Section 1's diagnosis was wrong in two
> ways. The demo site is `clockwork-commerce-demo.netlify.app`, not
> `commerce-demo.netlify.app` (that is an unrelated site outside the account).
> And the site was never linked to the GitHub repository: there is no broken
> webhook to repair, because the demo deploys directly from a local checkout by
> design. The route, command, and token are in
> [docs/operations/demo-deploy.md](../operations/demo-deploy.md). The branch
> cleanup in section 3 is done; only `main` remains on the remote.
>
> **Resolved.** The demo deployed successfully from `main` on 2 Aug 2026 and
> serves the current build. Section 1 is history: keep it for the diagnosis
> trail, and treat the runbook as the standing instruction. Nothing about the
> deploy is blocked.

## 1. Netlify is not deploying (the blocking item)

**Symptom.** No production deploy since the night of 1 Aug. `main` has advanced
three times today and the deployed site still serves the previous build.

**Evidence.**

- GitHub has recorded the pushes to `main`: `2026-08-02T14:11:49Z`, `14:24:53Z`,
  `14:35:27Z`.
- `gh api repos/fil-one/clockwork/hooks` returns `[]`. The repository
  has no webhooks at all, so nothing is notifying Netlify on push.
- `https://commerce-demo.netlify.app/demo/access` still serves
  `<html lang="en">` with no class attribute. The current `main` renders
  `<html lang="en" data-scroll-behavior="smooth" class="aspekta_… funnelsans_… funneldisplay_…">`,
  so the presence of `aspekta` in that tag is a reliable one-line check for
  whether the new build is live.

**What to check, in the Netlify UI, in this order.**

1. Site configuration → Build & deploy → Continuous deployment. Confirm the site
   is still linked to `fil-one/clockwork` and that the production
   branch is `main`.
2. The same page → Build settings. Confirm builds are not stopped. A site whose
   builds were paused shows "Builds are stopped" and silently ignores pushes.
3. GitHub → Settings → Integrations → GitHub Apps. Confirm the Netlify app is
   installed and has access to this repository. A revoked or repo-scoped
   installation removes the webhook, which matches the empty `hooks` list.
4. If the link is intact but stale, relinking the repository in Netlify
   recreates the hook. A build hook plus `curl -X POST <hook-url>` is the quick
   unblock and deploys the current `main` without fixing the underlying link.

**Verification once it deploys.**

```sh
curl -s https://commerce-demo.netlify.app/demo/access | grep -o '<html[^>]*'
```

Expect the three font variable classes. Then sign in as any persona and sign
out; it should land on the persona picker, not an error card.

Netlify build settings live in `netlify.toml`: the command is
`pnpm exec turbo run build --filter=@clockwork/web`, publish `apps/web/.next`,
Node 24, with `@netlify/plugin-nextjs`. Nothing there changed in this work, and
`pnpm --filter @clockwork/web build` succeeds locally, so the build itself is
not the problem.

## 2. Git is fully consolidated

`main` is at `acdb243`. Nothing is outstanding.

| PR  | Title                                                          | State  |
| --- | -------------------------------------------------------------- | ------ |
| #2  | Conform the experience to the Fil One brand visual language    | merged |
| #3  | Clear the demo persona when a demo session signs out           | merged |
| #4  | Stop the quote payload test depending on the runner's timezone | merged |

The working tree is clean and only `main` exists locally.

## 3. Cleanup that is still pending

Four merged remote branches were not deleted:

```sh
git push origin --delete brand/fil-one-visual-conformance
git push origin --delete fix/demo-persona-sign-out
git push origin --delete fix/timezone-dependent-quote-test
git push origin --delete claude/improve-readme-886f0r   # from PR #1, confirm first
git remote prune origin
```

## 4. Known open items, none blocking

**CI is red on `main` and was red before this work.** Verified by comparing
shard outcomes at `b460396`, the base commit, against the branch: identical.
Causes, in the order worth fixing:

1. `integration` — `toomanyrequests: Rate exceeded` pulling Supabase images.
   Needs a Docker Hub credential on the repository, not a code change.
2. `static` and `proof` — the runner's own checkout step fails with
   `could not lock config file /dev/null: Permission denied` during
   `git config --global`. Harness, not the suite.
3. `ui` — timeouts and `net::ERR_ABORTED; maybe frame was detached`. The failing
   set differs between runs, which reads as an unstable dev server on the runner
   rather than a deterministic break. The same suite is 82 of 82 locally on
   macOS.

The one genuine code defect in that set, a timezone-dependent quote test, is
fixed in PR #4.

**Golden PDF.** `packages/documents/src/render.integration.test.ts` fails on
`direct_quote` with a deterministic hash mismatch. Pre-existing, proven at an
earlier base commit, and deliberately not regenerated: a golden is a tripwire
and regenerating it without establishing what drifted defeats the purpose. Still
an open decision.

**Document palette.** `packages/documents` keeps its own green-tinted palette
and a `#0067CC` accent, so rendered PDFs now visibly diverge from the
application. Left alone on purpose: those bytes are hash-pinned to legal
fixtures, so changing them lands in `EXT-LEGAL-01` territory. Worth a separate
pass.

**Vector marks.** `apps/web/public/brand/` holds PNGs only. The text wordmark
therefore cannot compose the circular icon, and the icon cannot recolour for an
inverse surface. `EXT-BRAND-01` now lists vector versions of the marks as an
outstanding input. Ask for `fo-icon.svg`, `fo-icon-mono.svg` with paths on
`currentColor`, and `fo-wordmark.svg`.

**Auxiliary type below the documented floor.** The design system sets a 12 CSS
px floor for auxiliary text; a set of dense operator labels sits at 10.4 to 11.2
px. Recorded in `docs/design/fil-one-experience-system.md` rather than silently
changed, because raising them is a reflow change at 320 px.

## 5. Things a follow-up agent will need

- The demo gate password is required by the `demo-chromium` Playwright project
  and by `pnpm generate:baseline`, which shells out to `playwright test --list`
  and throws without it. Any value satisfies the enumeration; only the real
  value passes the gate. Do not put it in a local `.env`: Next would load it for
  `next dev` and turn the password gate on for every other local Playwright run.
- Visual baselines regenerate only on macOS and in two commands, because the
  four demo shots live in a separate Playwright project:

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
  pnpm --filter @clockwork/web exec playwright test e2e/visual.spec.ts \
  --project=chromium --update-snapshots --workers=1

CLOCKWORK_DEMO_ACCESS_PASSWORD=<secret> CLOCKWORK_EXPERIENCE_ADAPTER=demo \
CLOCKWORK_EVIDENCE_ADAPTER=demo NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
  pnpm --filter @clockwork/web exec playwright test e2e/demo.spec.ts \
  --project=demo-chromium --update-snapshots --workers=1
```

- After regenerating, refresh the SHA-256 rows in
  `docs/design/reject-list-audit.md` and run `pnpm generate:baseline` on a clean
  tree, with `apps/web/.netlify/` moved aside. That directory is gitignored
  build output and the manifest script will otherwise record it, which makes the
  manifest machine-specific.
