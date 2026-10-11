# Working on Fil One Commerce

Use [the contributor guide](docs/contributing.md#proportionate-validation) to
choose validation for the change. Small edits should receive focused checks, not
a fresh qualification of the entire product.

- Before testing, identify the behavior affected and the smallest checks that
  cover it. Reuse existing tests; add regression coverage for meaningful bugs,
  not assertions that merely restate a cosmetic edit.
- For documentation, review the diff, links and formatting. For copy or layout,
  inspect the affected screen or rendered document and run relevant existing
  tests. Do not start databases or call live providers without a relevant
  change.
- Run the selected checks once after the final edit. Repeat or broaden them only
  for subsequent changes, failures or a specific unresolved risk. Hooks and CI
  still apply; do not duplicate the full CI suite locally by default.
- For MNDA changes, follow the scoped validation guidance in
  [the MNDA runbook](docs/operations/commerce-mnda.md#change-validation). A
  spacing or email change does not automatically require another complete
  signing flow.
- After an application deployment, rely on the deployment smoke checks and a
  focused verification of changed behavior. Do not recreate live transactions to
  reconfirm unrelated behavior. Documentation-only changes need no manual
  application deployment.
- Report the outcome, relevant checks and any remaining limitation briefly.
  Separate implementation time from time spent waiting for CI or deployment.
- Prefer the authenticated Commerce MCP server for routine operational reads and
  supported changes. For staff roles, use `list_staff` and
  `prepare_staff_role_change`, then complete the explicit Team review with
  recent authentication. Never treat a prepared request as an applied change.
  Use deployment-time staff provisioning only for initial access or recovery
  when an administrator cannot use Team. Keep access tokens out of chat and
  repository files; see [MCP setup](docs/operations/mcp.md).

This guidance does not change hooks or deployment automation. GitHub has no
required checks; the Deploy workflow deploys only after a green CI run on
`main`.
