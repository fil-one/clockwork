-- Permission tests in row policies run once per statement instead of once per
-- row.
--
-- app_has_permission and app_has_any_permission read the signed claim: each
-- call verifies its HMAC against private.authorization_secrets twice
-- (app_context_is_valid, then again through app_context_claims), each time
-- inside an exception block. Written bare in a policy, they run for every row
-- the policy filters, so a customer listing invoices paid for three signature
-- checks per invoice in the table. Wrapped in a scalar subquery,
-- `(select app_has_permission(...))`, Postgres evaluates them once per
-- statement as an InitPlan and reuses the result.
--
-- Every policy that tests a permission is restated below exactly as the earlier
-- migrations left it, except that each call that reads no column of the row is
-- wrapped: app_has_permission, app_has_any_permission, app_current_user_id,
-- experience_session_is_internal, experience_session_assisted_account and
-- app_is_internal. A call that takes a column (app_has_account(account_id),
-- app_is_current_user(owner_user_id)) still runs per row.
--
-- The wrapped calls return the same value for every row of a statement. Each
-- is STABLE and depends only on the current role, the transaction's
-- app.authorization_context and app.authorization_signature settings (no SQL
-- in this database changes them), the active signing secrets as of the
-- statement's snapshot, and statement_timestamp() for expiry (001300).
--
-- app_context_claims keeps its exception block. Every role may execute it, but
-- only the two application roles may execute app_context_is_valid, so for any
-- other role the block turns a permission error into an empty claim.
--
-- scripts/qualify-permission-upgrade.ts --unchanged-from 001454 proves every
-- persona reads and writes exactly the same rows before and after this
-- migration, and supabase/tests/1454_policy_initplans.test.sql keeps permission
-- tests out of the per-row path.

alter policy guard_i_accounts_7a90e38a on public.accounts
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_u_accounts_7a90e38a on public.accounts
  using ((select app_has_permission('account:write'::text)))
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_i_agreements_5fb7551c on public.agreements
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_u_agreements_5fb7551c on public.agreements
  using ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_i_amendment_lines_f5e24dc4 on public.amendment_lines
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_amendment_lines_f5e24dc4 on public.amendment_lines
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_i_amendments_39576081 on public.amendments
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_amendments_39576081 on public.amendments
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy audit_events_finance_insert on public.audit_events
  with check (((select app_has_permission('billing:approve'::text)) AND ((actor ->> 'id'::text) = ((select app_current_user_id()))::text) AND (aggregate_type = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'refund'::text, 'dispute'::text, 'dispute_case'::text, 'collection_case'::text, 'collection_action'::text]))));

alter policy audit_events_finance_insert_guard on public.audit_events
  with check (((select app_has_permission('audit:append'::text)) OR (((actor ->> 'id'::text) = ((select app_current_user_id()))::text) AND (app_has_account(account_id) OR (aggregate_type = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'refund'::text, 'dispute'::text, 'dispute_case'::text, 'collection_case'::text, 'collection_action'::text]))))));

alter policy audit_events_finance_read on public.audit_events
  using (((select app_has_permission('billing:approve'::text)) AND (((actor ->> 'id'::text) = ((select app_current_user_id()))::text) OR ((aggregate_type = 'credit_note'::text) AND (EXISTS ( SELECT 1
   FROM credit_notes adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'refund'::text) AND (EXISTS ( SELECT 1
   FROM refunds adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = ANY (ARRAY['dispute'::text, 'dispute_case'::text])) AND (EXISTS ( SELECT 1
   FROM dispute_cases adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'collection_case'::text) AND (EXISTS ( SELECT 1
   FROM core_collection_cases collection_case
  WHERE ((collection_case.id = audit_events.aggregate_id) AND (collection_case.owner_user_id = (select app_current_user_id())))))))));

alter policy audit_events_finance_visibility_guard on public.audit_events
  using (((select app_has_permission('audit:read'::text)) OR ((actor ->> 'id'::text) = ((select app_current_user_id()))::text) OR ((aggregate_type = 'credit_note'::text) AND (EXISTS ( SELECT 1
   FROM credit_notes adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'refund'::text) AND (EXISTS ( SELECT 1
   FROM refunds adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = ANY (ARRAY['dispute'::text, 'dispute_case'::text])) AND (EXISTS ( SELECT 1
   FROM dispute_cases adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'collection_case'::text) AND (EXISTS ( SELECT 1
   FROM core_collection_cases collection_case
  WHERE ((collection_case.id = audit_events.aggregate_id) AND (collection_case.owner_user_id = (select app_current_user_id()))))))));

alter policy audit_events_insert_role_guard on public.audit_events
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'billing:write'::text, 'partner:quote:write'::text, 'deal:register'::text, 'billing:approve'::text, 'agreement:approve'::text, 'destructive:approve'::text])));

alter policy commission_accruals_insert_role_guard on public.commission_accruals
  with check ((select app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text])));

alter policy commission_accruals_update_role_guard on public.commission_accruals
  using ((select app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text])));

alter policy guard_i_commitment_entries_3e71e327 on public.commitment_entries
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_commitment_entries_3e71e327 on public.commitment_entries
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_i_commitment_ledgers_6e140599 on public.commitment_ledgers
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_commitment_ledgers_6e140599 on public.commitment_ledgers
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_i_core_amendment_financial_terms_a534e753 on public.core_amendment_financial_terms
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_core_amendment_financial_terms_a534e753 on public.core_amendment_financial_terms
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_i_core_amendment_line_supersessions_b1d691c3 on public.core_amendment_line_supersessions
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_core_amendment_line_supersessions_b1d691c3 on public.core_amendment_line_supersessions
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy core_billing_policies_finance_read on public.core_billing_policies
  using ((select app_has_permission('billing:approve'::text)));

alter policy core_collection_actions_finance_insert on public.core_collection_actions
  with check (((select app_has_permission('billing:approve'::text)) AND (actor_user_id = (select app_current_user_id())) AND (EXISTS ( SELECT 1
   FROM core_collection_cases collection_case
  WHERE (collection_case.id = core_collection_actions.collection_case_id)))));

alter policy core_collection_actions_finance_read on public.core_collection_actions
  using (((select app_has_permission('billing:approve'::text)) AND (actor_user_id = (select app_current_user_id()))));

alter policy core_collection_cases_finance_insert on public.core_collection_cases
  with check (((select app_has_permission('billing:approve'::text)) AND (owner_user_id = (select app_current_user_id())) AND (EXISTS ( SELECT 1
   FROM invoices source_invoice
  WHERE ((source_invoice.id = core_collection_cases.invoice_id) AND (source_invoice.account_id = core_collection_cases.account_id))))));

alter policy core_collection_cases_finance_read on public.core_collection_cases
  using ((select app_has_permission('billing:approve'::text)));

alter policy core_collection_cases_finance_update on public.core_collection_cases
  using ((select app_has_permission('billing:approve'::text)))
  with check (((select app_has_permission('billing:approve'::text)) AND (EXISTS ( SELECT 1
   FROM invoices source_invoice
  WHERE ((source_invoice.id = core_collection_cases.invoice_id) AND (source_invoice.account_id = core_collection_cases.account_id))))));

alter policy guard_i_core_order_commercial_profiles_02ebcc0c on public.core_order_commercial_profiles
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_core_order_commercial_profiles_02ebcc0c on public.core_order_commercial_profiles
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_i_core_order_line_snapshots_54c9c21c on public.core_order_line_snapshots
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_core_order_line_snapshots_54c9c21c on public.core_order_line_snapshots
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy core_transfer_tiers_economics_select_guard on public.core_partner_transfer_tiers
  using ((select app_has_permission('billing:approve'::text)));

alter policy core_price_activation_finance_read on public.core_price_book_activation_events
  using ((select app_has_permission('quote:approve'::text)));

alter policy guard_i_core_quote_commercial_profiles_53d0c407 on public.core_quote_commercial_profiles
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_u_core_quote_commercial_profiles_53d0c407 on public.core_quote_commercial_profiles
  using ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_i_core_quote_snapshots_d56d5619 on public.core_quote_snapshots
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_u_core_quote_snapshots_d56d5619 on public.core_quote_snapshots
  using ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy core_tax_rates_finance_read on public.core_tax_rates
  using ((select app_has_permission('billing:approve'::text)));

alter policy core_tax_activation_finance_read on public.core_tax_rule_book_activation_events
  using ((select app_has_permission('billing:approve'::text)));

alter policy core_tax_rule_books_finance_read on public.core_tax_rule_books
  using ((select app_has_permission('billing:approve'::text)));

alter policy credit_notes_finance_insert on public.credit_notes
  with check ((select app_has_permission('billing:approve'::text)));

alter policy credit_notes_read on public.credit_notes
  using (((select app_has_permission('billing:approve'::text)) OR (EXISTS ( SELECT 1
   FROM invoices invoice
  WHERE ((invoice.id = credit_notes.invoice_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_credit_notes_dbe263ee on public.credit_notes
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_credit_notes_dbe263ee on public.credit_notes
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_i_deal_registrations_606b79cc on public.deal_registrations
  with check ((select app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text])));

alter policy guard_u_deal_registrations_606b79cc on public.deal_registrations
  using ((select app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text])));

alter policy dispute_cases_finance_insert on public.dispute_cases
  with check ((select app_has_permission('billing:approve'::text)));

alter policy dispute_cases_read on public.dispute_cases
  using (((select app_has_permission('billing:approve'::text)) OR (EXISTS ( SELECT 1
   FROM (payments payment
     JOIN invoices invoice ON ((invoice.id = payment.invoice_id)))
  WHERE ((payment.id = dispute_cases.payment_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_dispute_cases_7737ddf1 on public.dispute_cases
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_dispute_cases_7737ddf1 on public.dispute_cases
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_i_documents_21f64da1 on public.documents
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_u_documents_21f64da1 on public.documents
  using ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy entitlements_finance_read on public.entitlements
  using ((select app_has_permission('billing:approve'::text)));

alter policy guard_i_entitlements_86b3bc08 on public.entitlements
  with check ((select app_has_permission('operations:write'::text)));

alter policy guard_u_entitlements_86b3bc08 on public.entitlements
  using ((select app_has_permission('operations:write'::text)))
  with check ((select app_has_permission('operations:write'::text)));

alter policy experience_delivery_read on public.experience_artifact_deliveries
  using ((((audience = 'internal'::text) AND (account_id IS NULL) AND (select experience_session_is_internal()) AND (select app_has_permission('operations:write'::text)) AND ((select experience_session_assisted_account()) IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(audience_account_id))));

alter policy experience_render_insert on public.experience_document_render_requests
  with check ((app_is_current_user(requested_by) AND (((audience = 'internal'::text) AND (account_id IS NULL) AND (audience_account_id IS NULL) AND (select experience_session_is_internal()) AND (select app_has_permission('operations:write'::text)) AND ((select experience_session_assisted_account()) IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(account_id) AND app_has_account(audience_account_id)))));

alter policy experience_render_read on public.experience_document_render_requests
  using ((((audience = 'internal'::text) AND (account_id IS NULL) AND (select experience_session_is_internal()) AND (select app_has_permission('operations:write'::text)) AND ((select experience_session_assisted_account()) IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(account_id) AND app_has_account(audience_account_id))));

alter policy experience_evidence_insert on public.experience_evidence_uploads
  with check ((app_is_current_user(owner_user_id) AND (app_has_account(account_id) OR ((select experience_session_is_internal()) AND (((select experience_session_assisted_account()) IS NULL) OR (account_id = (select experience_session_assisted_account()))) AND (((journey = 'exception'::text) AND (select app_has_permission('operations:write'::text))) OR ((journey = 'approval'::text) AND (select app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text]))))))));

alter policy experience_evidence_read on public.experience_evidence_uploads
  using ((app_is_current_user(owner_user_id) AND (app_has_account(account_id) OR ((select experience_session_is_internal()) AND (((select experience_session_assisted_account()) IS NULL) OR (account_id = (select experience_session_assisted_account()))) AND (((journey = 'exception'::text) AND (select app_has_permission('operations:write'::text))) OR ((journey = 'approval'::text) AND (select app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text]))))))));

alter policy experience_projection_read on public.experience_portal_projections
  using ((((audience = 'internal'::text) AND (select experience_session_is_internal()) AND (((select experience_session_assisted_account()) IS NULL) OR (subject_account_id = (select experience_session_assisted_account()))) AND (((channel = 'approvals'::text) AND (select app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text]))) OR ((channel <> 'approvals'::text) AND (select app_has_permission('operations:write'::text))))) OR ((audience <> 'internal'::text) AND app_has_account(audience_account_id) AND ((audience <> 'partner'::text) OR (channel <> ALL (ARRAY['billing'::text, 'commissions'::text, 'renewals'::text, 'sandboxes'::text, 'brand'::text])) OR ((select app_has_permission('deal:register'::text)) AND (select app_has_permission('account:write'::text))) OR ((select experience_session_is_internal()) AND ((select experience_session_assisted_account()) = audience_account_id))))));

alter policy guard_i_inbound_notices_ab0c7a3e on public.inbound_notices
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_u_inbound_notices_ab0c7a3e on public.inbound_notices
  using ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_i_invites_4a46687a on public.invites
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_u_invites_4a46687a on public.invites
  using ((select app_has_permission('account:write'::text)))
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_i_invoices_56deca22 on public.invoices
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_invoices_56deca22 on public.invoices
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy invoices_finance_read on public.invoices
  using ((select app_has_permission('billing:approve'::text)));

alter policy guard_i_key_terms_e2d758b0 on public.key_terms
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_u_key_terms_e2d758b0 on public.key_terms
  using ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy lifecycle_offboarding_tenant_update on public.lifecycle_offboarding_plans
  using (((select app_is_internal()) OR (app_has_account(account_id) AND (select app_has_permission('destructive:approve'::text)))))
  with check (((select app_is_internal()) OR (app_has_account(account_id) AND (select app_has_permission('destructive:approve'::text)))));

alter policy guard_i_novations_955355ef on public.novations
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text])));

alter policy guard_i_order_lines_6e8cec88 on public.order_lines
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_order_lines_6e8cec88 on public.order_lines
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_i_orders_12c500ed on public.orders
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_u_orders_12c500ed on public.orders
  using ((select app_has_permission('order:write'::text)))
  with check ((select app_has_permission('order:write'::text)));

alter policy guard_i_organizations_d9811f03 on public.organizations
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_u_organizations_d9811f03 on public.organizations
  using ((select app_has_permission('account:write'::text)))
  with check ((select app_has_permission('account:write'::text)));

alter policy outbox_messages_finance_insert on public.outbox_messages
  with check (((select app_has_permission('billing:approve'::text)) AND (EXISTS ( SELECT 1
   FROM audit_events finance_event
  WHERE ((finance_event.id = outbox_messages.event_id) AND ((finance_event.actor ->> 'id'::text) = ((select app_current_user_id()))::text))))));

alter policy outbox_messages_finance_insert_guard on public.outbox_messages
  with check (((select app_has_permission('audit:append'::text)) OR (EXISTS ( SELECT 1
   FROM audit_events finance_event
  WHERE ((finance_event.id = outbox_messages.event_id) AND ((finance_event.actor ->> 'id'::text) = ((select app_current_user_id()))::text))))));

alter policy outbox_messages_insert_role_guard on public.outbox_messages
  with check ((select app_has_any_permission(ARRAY['account:write'::text, 'billing:write'::text, 'partner:quote:write'::text, 'deal:register'::text, 'billing:approve'::text, 'agreement:approve'::text, 'destructive:approve'::text])));

alter policy guard_i_payments_84d5eaf7 on public.payments
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_payments_84d5eaf7 on public.payments
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy payments_finance_read on public.payments
  using ((select app_has_permission('billing:approve'::text)));

alter policy guard_i_pocs_51925df6 on public.pocs
  with check ((select app_has_permission('poc:manage'::text)));

alter policy guard_u_pocs_51925df6 on public.pocs
  using ((select app_has_permission('poc:manage'::text)))
  with check ((select app_has_permission('poc:manage'::text)));

alter policy price_books_finance_read on public.price_books
  using ((select app_has_permission('quote:approve'::text)));

alter policy guard_i_procurement_profiles_14572dd1 on public.procurement_profiles
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_u_procurement_profiles_14572dd1 on public.procurement_profiles
  using ((select app_has_permission('account:write'::text)))
  with check ((select app_has_permission('account:write'::text)));

alter policy guard_i_quote_lines_bd945660 on public.quote_lines
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_u_quote_lines_bd945660 on public.quote_lines
  using ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_i_quotes_2150fd65 on public.quotes
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy guard_u_quotes_2150fd65 on public.quotes
  using ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text])));

alter policy rate_cards_economics_select_guard on public.rate_cards
  using ((select app_has_permission('quote:approve'::text)));

alter policy rate_cards_finance_read on public.rate_cards
  using ((select app_has_permission('quote:approve'::text)));

alter policy guard_i_refunds_0084ff71 on public.refunds
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_refunds_0084ff71 on public.refunds
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy refunds_finance_insert on public.refunds
  with check ((select app_has_permission('billing:approve'::text)));

alter policy refunds_read on public.refunds
  using (((select app_has_permission('billing:approve'::text)) OR (EXISTS ( SELECT 1
   FROM (payments payment
     JOIN invoices invoice ON ((invoice.id = payment.invoice_id)))
  WHERE ((payment.id = refunds.payment_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_report_exports_a2ebaa4e on public.report_exports
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy guard_u_report_exports_a2ebaa4e on public.report_exports
  using ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])))
  with check ((select app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text])));

alter policy terminations_insert_role_guard on public.terminations
  with check ((select app_has_permission('account:write'::text)));

alter policy terminations_update_role_guard on public.terminations
  using ((select app_has_permission('system:operate'::text)))
  with check ((select app_has_permission('system:operate'::text)));

alter policy guard_i_usage_events_f6c8fb56 on public.usage_events
  with check ((select app_has_permission('operations:write'::text)));

alter policy guard_u_usage_events_f6c8fb56 on public.usage_events
  using ((select app_has_permission('operations:write'::text)))
  with check ((select app_has_permission('operations:write'::text)));
