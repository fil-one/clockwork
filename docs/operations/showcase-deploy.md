# Fil One Commerce sales showcase

The shareable introduction lives in `apps/showcase`. It presents the value of
Fil One Commerce, a five-step interactive deal, and the planned Fil One platform
connection. Public pages use the product name; historical package and repository
identifiers remain compatible with existing tooling.

## Local development and validation

Use Node 24.18.1 and pnpm 10.34.5 from the repository toolchain.

```sh
pnpm install --frozen-lockfile
pnpm --filter @clockwork/showcase dev
```

Open <http://localhost:3100>. To qualify the production build:

```sh
pnpm --filter @clockwork/showcase test:unit
pnpm --filter @clockwork/showcase build
pnpm --filter @clockwork/showcase exec playwright install chromium
pnpm --filter @clockwork/showcase test:e2e
```

The browser suite covers the complete deal, confirmation delays and retry,
independent visitors, reloads, direct links, navigation history, language
changes, localized sharing images, accessibility, and narrow screens. GitHub
runs this suite in the Sales showcase workflow.

## Languages and copy

English, Spanish, French, German, Japanese, Portuguese, Simplified Chinese, and
Arabic have complete message catalogs. Three translation agents wrote and
cross-reviewed the launch copy, with a second plain-language editorial pass.
This is agent-reviewed translation, not a claim of native-speaker certification.
Spanish uses Spain as its primary locale, with wording that also reads naturally
in Mexico and Colombia. Preserve the established `presupuesto`, `socio`, and
formal `usted` terminology. Three independent reviewers completed a final
Spanish pass across the landing page, tour states, and workspace handoff.

The URL carries the language. The selector preserves the current scene and
integration mode. A cookie remembers the preference; browser language is used on
a first visit. The page sends only the selected catalog to the browser. Arabic
has RTL layout and directional isolation for interpolated values.

Edit complete messages in `lib/locales/`, retaining placeholder names across
languages. Tests enforce exact catalog and placeholder coverage. Keep copy
focused on buyer benefits; use concise sample and planned-integration labels.
Localized social images use bundled fonts; regenerate their text subsets when
changing image copy (see `app/fonts/README.md`).

## Netlify while tuning

The tuning site is `fil-one-commerce-preview`, ID
`ec42b9f9-ec9e-4272-920e-ac3d35809958`, for `@clockwork/showcase`. Select
`apps/showcase` as its package directory, keep the repository root as the base
directory, and use `apps/showcase/netlify.toml`. The operational sandbox
continues to use the root `netlify.toml`; these are separate deployments.

Both tuning sites are public. Keep Netlify site-wide password protection off and
leave `CLOCKWORK_DEMO_ACCESS_PASSWORD` unset on the operational demo.

No provider keys, database, payment credentials, or environment variables are
needed for the showcase application. `SHOWCASE_URL` may set the canonical
origin; Netlify's `URL` is also supported. Do not enable continuous deployment:
commit, push, merge, and deploy the clean, current `main` checkout.

```sh
pnpm exec netlify deploy --build --filter @clockwork/showcase --site ec42b9f9-ec9e-4272-920e-ac3d35809958
```

Check the draft's localized pages, complete tour, and social images. Publish the
verified deployment with Netlify's `restoreSiteDeploy` API, then repeat the
smoke check on the published URL. Record the commit and deploy ID with the
release.

## Vercel readiness

Import this repository and select `apps/showcase` as the root directory. Enable
access to files outside the root for workspace installation. The app's
`vercel.json` selects Next.js and the pnpm commands. Use Node 24 and set
`SHOWCASE_URL` to the final HTTPS origin for canonical and share URLs. No
runtime secrets are needed. Deploy the same reviewed `main` commit.

## Isolation and the full demo

Each browser tab has its own sample deal in session storage. A shared URL
carries the language, scene, and preview mode; it does not export a visitor's
actions. Preparing a later step marks its earlier events as prepared sample
history. Nothing in the tour calls a payment or service provider.

Links to the full workspace demo retain the selected language with `lang`. The
operational app consumes that preference before opening the selected workspace.
Deploy that app separately using
[the operational demo procedure](demo-deploy.md) when its code changes.
