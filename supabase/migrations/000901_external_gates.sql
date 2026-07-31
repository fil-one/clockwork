create table system_external_gates (
  id uuid primary key default gen_random_uuid(),
  gate_key text not null unique check (gate_key ~ '^EXT-[A-Z]+-[0-9]{2}$'),
  title text not null check (length(trim(title)) > 0),
  owner text not null check (length(trim(owner)) > 0),
  input_required text not null check (length(trim(input_required)) > 0),
  affected_feature text not null check (length(trim(affected_feature)) > 0),
  severity text not null check (length(trim(severity)) > 0),
  configured_status text not null default 'blocked'
    check (configured_status in ('blocked','review','pending','active','not_required')),
  simulator_state text not null default 'unavailable'
    check (simulator_state in ('ready','degraded','unavailable')),
  simulator_details text not null check (length(trim(simulator_details)) > 0),
  last_activation_test_status text not null default 'never'
    check (last_activation_test_status in ('never','passed','failed')),
  last_activation_test_at timestamptz,
  last_activation_tested_by text,
  activation_evidence_reference text,
  review_on date,
  status_reason text not null check (length(trim(status_reason)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint system_external_gates_test_evidence check (
    last_activation_test_status = 'never'
    or (
      last_activation_test_at is not null
      and length(trim(last_activation_tested_by)) > 0
      and length(trim(activation_evidence_reference)) > 0
    )
  ),
  constraint system_external_gates_active_check check (
    configured_status <> 'active'
    or (
      simulator_state = 'ready'
      and last_activation_test_status = 'passed'
      and review_on is not null
      and review_on >= last_activation_test_at::date
    )
  ),
  constraint system_external_gates_not_required_check check (
    configured_status <> 'not_required'
    or (
      length(trim(status_reason)) > 0
      and length(trim(activation_evidence_reference)) > 0
      and review_on is not null
    )
  )
);

create index system_external_gates_status_idx
  on system_external_gates(configured_status, review_on);
create trigger system_external_gates_version before update on system_external_gates
for each row execute function touch_versioned_row();

alter table system_external_gates enable row level security;
alter table system_external_gates force row level security;
create policy system_external_gates_internal on system_external_gates
for all using (app_is_internal()) with check (app_is_internal());
grant select, insert, update, delete on system_external_gates
to clockwork_runtime, clockwork_service;

insert into system_external_gates (
  id, gate_key, title, owner, input_required, affected_feature, severity,
  configured_status, simulator_state, simulator_details, status_reason
) values
('90000000-0000-4000-8000-000000000001','EXT-ACC-01','Hosted accounts and credentials','Platform owner','Scoped hosted accounts, projects, credentials, MFA policy IDs, and webhook subscriptions','Hosted database, auth, workflows, billing, evidence, notifications, and projections','path_blocker','blocked','ready','Provider and local-stack failure/replay simulators are available','Production credentials and policy evidence are pending'),
('90000000-0000-4000-8000-000000000002','EXT-LEGAL-01','Counsel-approved legal policy','Counsel','Approved templates, thresholds, KeyTerms, screening, retention, survival, and country rules','Agreement execution, renewal, termination, screening, and partner continuity','launch_blocker','blocked','ready','Versioned exact-hash and policy-boundary fixtures are available','Counsel-approved inputs are pending'),
('90000000-0000-4000-8000-000000000003','EXT-COMMERCIAL-01','Commercial inputs','Product and finance','Signed SKU, currencies, minimums, overage, floors, partner tiers, credit, and claims inputs','Pricing, quoting, commitment, partner economics, documents, and reports','launch_blocker','blocked','ready','Fictional USD, EUR, and GBP price books cover every channel','Signed production commercial data is pending'),
('90000000-0000-4000-8000-000000000004','EXT-PROVIDER-01','Provider selections','Product, accounting, and legal','Selected e-sign, notifications, CRM, screening, support, and QBO connector contracts','Concrete provider adapters and operating procedures','path_blocker','blocked','ready','Provider contract fakes cover failures, replay, and reordering','Production provider selections are pending'),
('90000000-0000-4000-8000-000000000005','EXT-PROVISION-01','Product provisioning contract','Product platform owner','Authenticated provisioning, usage, confirmation, entitlement, re-drive, and teardown contract','Order-to-entitlement, POC conversion, usage, billing trigger, and teardown','paid_activation_blocker','blocked','ready','Replay-safe provisioning and teardown simulator is available','Authenticated product boundary is pending'),
('90000000-0000-4000-8000-000000000006','EXT-TAX-01','Tax and accounting policy','Accountant and counsel','Registrations, tax/exemption rules, invoice entities, QBO mappings, revenue recognition, and credit policy','International tax, accounting exports, collections, and reconciliation','country_blocker','blocked','ready','US, ES, UK, QBO, and three-way tie-out fixtures are available','Country and accounting approval is pending'),
('90000000-0000-4000-8000-000000000007','EXT-DOMAIN-01','Domains and callback records','Platform and IT','DNS, TLS, AuthKit redirects, webhook endpoints, CSRF origins, and sender records','Authentication callbacks, custom branding, webhooks, and notifications','launch_blocker','blocked','ready','Local origins and deterministic callback/domain fixtures are available','Production DNS and sender records are pending'),
('90000000-0000-4000-8000-000000000008','EXT-BRAND-01','Brand approval','Brand owner','Approved assets, licenses, palette, claims copy, legal entity, and document footer','Portal, custom branding, generated documents, and public polish','high','review','ready','Neutral tokens, text mark, branded PDF, and safe fallback are available','Final brand review is pending'),
('90000000-0000-4000-8000-000000000009','EXT-APPROVERS-01','Named operations approvers','Operations owner','Named queue primaries/backups, approval roles, targets, escalation, and on-call ownership','Queue routing, separation of duties, migration, teardown, and readiness','operations_blocker','blocked','ready','Fictional rota, absence routing, and two-person denial are available','Real named operations roster is pending'),
('90000000-0000-4000-8000-000000000010','EXT-TEARDOWN-01','Teardown authority','Product, security, and legal','Written decision, scope, flag owner, retention rules, and two-person policy','Automated termination teardown only','conditional','pending','ready','Two-person retention-aware teardown simulator is available','Automation remains disabled; manual safe offboarding is available'),
('90000000-0000-4000-8000-000000000011','EXT-MARKETPLACE-01','Marketplace enrollment','Channel, product, and finance','AWS, Azure, and Google enrollment, seller IDs, permissions, payout, settlement, and credentials','Marketplace order, entitlement, metering, settlement, and reconciliation','channel_blocker','blocked','ready','AWS, Azure, and Google order/settlement simulators are available','Marketplace enrollment and payout access are pending'),
('90000000-0000-4000-8000-000000000012','EXT-MIGRATION-01','Production migration window','Product, platform, and operations','Production source access, immutable snapshot, quiet window, named operators, and communication timing','Post-launch existing-customer migration execution','post_launch','pending','ready','Snapshot discovery, rehearsal, resume, and rollback-boundary fixtures are available','Production source access and quiet window are pending');
