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
CI=1 NETLIFY_AUTH_TOKEN=nfp_if4DBUaRcnmfdH8VK5GR1P3dceNtJw8y1cf2 \
  npx -y netlify-cli@latest deploy --build --prod \
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
- The token is a Netlify personal access token, stored here deliberately
  (private repository, James's call). If it stops working, create a new one at
  Netlify → User settings → Applications → Personal access tokens.

## Environment

All demo configuration lives on the Netlify site (Site configuration →
Environment variables), scoped to builds, functions, and runtime:
`CLOCKWORK_DEMO_DEPLOY`, `NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY`,
`CLOCKWORK_EXPERIENCE_ADAPTER`, `CLOCKWORK_EVIDENCE_ADAPTER`,
`CLOCKWORK_DEMO_ACCESS_PASSWORD`, `CLOCKWORK_DEMO_STATE_STORE`,
`NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV`, `NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS`,
`CLOCKWORK_CANONICAL_ORIGIN`, `CLOCKWORK_ENV`, `OTEL_SDK_DISABLED`.

None of these belong in a committed file or a local `.env`. The demo access
password in particular must stay out of `.env`, because `next dev` would load it
and turn the password gate on for every local Playwright run.

## Verifying a deploy

```sh
curl -s https://clockwork-commerce-demo.netlify.app/demo/access | grep -o '<html[^>]*'
```

A current build carries the three font variable classes (`aspekta_…`,
`funnelsans_…`, `funneldisplay_…`) on the `<html>` tag. Then sign in as any
persona and sign out; it should land on the persona picker, not an error card.

One naming trap: `commerce-demo.netlify.app` is a different, unrelated site that
is not in this account. The demo is `clockwork-commerce-demo`.
