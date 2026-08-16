# Vendored dependency patches

Every file here is applied by pnpm through `patchedDependencies` in the root
`package.json`. A patch is invisible maintenance debt, so each one is recorded
below with the condition that retires it. **Check this file before bumping any
of these dependencies.**

Patches apply on every install, including `--frozen-lockfile`, which is what CI
runs. A bump that changes the version key silently drops the patch — pnpm does
not warn — so the version in `patchedDependencies` must move with the
dependency, or the patch must be deleted deliberately.

## `next@16.2.12.patch`

**What:** adds `nonce: ctx.nonce` to the `<script>` element built by
`create-component-styles-and-scripts`.

**Why:** Next has two builders that emit a segment's client-chunk script tags
into the RSC tree. `get-layer-assets` handles `layout.tsx`/`page.tsx` and passes
the nonce. The route-convention builder — `template`, `error`, `loading`,
`not-found`, `forbidden`, `unauthorized` — does not. Sibling CSS in the same
builder is nonced correctly; only the script branch is affected.

Under this application's `strict-dynamic` policy the browser refuses that
element. The failure is worse than a refusal: Turbopack's chunk loader finds the
refused element already in the DOM and attaches an `error` listener to it rather
than inserting its own script, and that listener never fires because the
element's error already fired. The deferred promise never settles, so any client
component landing in that chunk renders **nothing, permanently, with no error
and no boundary**. Which components land there is decided by our own import
graph — a `loading.tsx` skeleton importing from the same module as its full page
is enough.

**Upstream:** vercel/next.js#92803. Open on canary, unmerged, in no release at
the time of writing — there is no version to upgrade to.

**Retire it when** a released Next carries #92803. Verify by checking whether
`create-component-styles-and-scripts` passes a nonce, then delete this patch and
its `patchedDependencies` entry.

**Ten sites, not two.** `next start` serves from precompiled bundles, so
patching only `dist/server/**` changes nothing that serves traffic — that was
measured, not assumed. The patch covers both `dist/server` copies (cjs and esm),
all four `dist/compiled/next-server/*.runtime.prod.js` bundles including the two
`-experimental` variants, and the four matching `.runtime.dev.js` files. The
minified `ctx` identifier differs per bundle.

**Why the file is 1.6 MB.** The compiled runtimes are single-line minified
bundles, so a one-property change diffs the whole line, eight times over.
Nothing is wrong with it; it simply regenerates wholesale on every bump.

**Guarded by** `apps/web/src/proxy-nonce-propagation.test.ts`, which drives both
Next builders directly and fails if either stops nonceing its script element. If
that test goes red after a Next bump, this patch was dropped.

## `minimatch@3.1.5.patch` and `minimatch@5.1.9.patch`

Predate this note and carry no recorded rationale; both are small enough to read
in full. If you touch either, replace this paragraph with the same shape as the
entry above — what, why, upstream, and the condition that retires it.
