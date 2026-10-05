-- Every row policy and function that named a role now tests a permission.
--
-- Roles are named bundles, defined once in packages/contracts/src/auth.ts and
-- mirrored into role_permissions (001445). Each role test below is replaced by
-- the permission test that admits exactly the same roles a session carried
-- before (a commerce administrator's session used to carry the four internal
-- roles it acts as; its bundle now holds every one of their permissions):
--
--   finance_approver                        billing:approve (quote:approve
--                                            for price books)
--   internal_operator                       operations:write
--   destructive_action_approver             destructive:approve
--   legal/finance/destructive approvers     agreement:approve, quote:approve,
--                                            billing:approve, destructive:approve
--   partner_admin (partner channels)        account:write
--   internal_operator, finance_approver     operations:write, billing:approve
--   destructive approver, operator          system:operate
--   owner, admin, partner_admin, operator   account:write (order:write on order
--                                            records, poc:manage on POCs)
--   owner, billing, operator, finance       billing:write, billing:approve,
--                                            operations:write
--   ... plus legal_approver                 account:write, agreement:approve
--   quote writers incl. partners, finance   quote:write, partner:quote:write,
--                                            quote:approve
--   partner roles, operator                 deal:register, operations:write
--   every role but member and revenue       account:write, billing:write,
--                                            partner:quote:write, deal:register,
--                                            billing:approve, agreement:approve,
--                                            destructive:approve
--
-- supabase/tests/1447_permission_policies.test.sql proves the equivalence
-- role by role, and 1448_restrictive_monotonicity.test.sql proves the
-- restrictive policies are monotone.
--
-- Restrictive policies may only test for the PRESENCE of a permission or for
-- facts about the row, never `not <role>`. The three finance guards were
-- written `not app_has_role('finance_approver') or <confinement>`, so adding
-- finance authority to a person took other rights away (001401, 001441). They
-- now admit anyone holding the wider right (`audit:read`, `audit:append`,
-- held by every role except the finance approver) or a row inside the
-- confinement. A pure finance approver is confined exactly as before, because
-- it lacks the wider right; a person who also holds another role keeps that
-- role's rights.

alter policy guard_i_accounts_7a90e38a on public.accounts
  with check (app_has_permission('account:write'::text));

alter policy guard_u_accounts_7a90e38a on public.accounts
  using (app_has_permission('account:write'::text))
  with check (app_has_permission('account:write'::text));

alter policy guard_i_agreements_5fb7551c on public.agreements
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_u_agreements_5fb7551c on public.agreements
  using (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]))
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_i_amendment_lines_f5e24dc4 on public.amendment_lines
  with check (app_has_permission('order:write'::text));

alter policy guard_u_amendment_lines_f5e24dc4 on public.amendment_lines
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy guard_i_amendments_39576081 on public.amendments
  with check (app_has_permission('order:write'::text));

alter policy guard_u_amendments_39576081 on public.amendments
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy audit_events_finance_insert on public.audit_events
  with check ((app_has_permission('billing:approve'::text) AND ((actor ->> 'id'::text) = (app_current_user_id())::text) AND (aggregate_type = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'refund'::text, 'dispute'::text, 'dispute_case'::text, 'collection_case'::text, 'collection_action'::text]))));

alter policy audit_events_finance_read on public.audit_events
  using ((app_has_permission('billing:approve'::text) AND (((actor ->> 'id'::text) = (app_current_user_id())::text) OR ((aggregate_type = 'credit_note'::text) AND (EXISTS ( SELECT 1
   FROM credit_notes adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'refund'::text) AND (EXISTS ( SELECT 1
   FROM refunds adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = ANY (ARRAY['dispute'::text, 'dispute_case'::text])) AND (EXISTS ( SELECT 1
   FROM dispute_cases adjustment
  WHERE (adjustment.id = audit_events.aggregate_id)))) OR ((aggregate_type = 'collection_case'::text) AND (EXISTS ( SELECT 1
   FROM core_collection_cases collection_case
  WHERE ((collection_case.id = audit_events.aggregate_id) AND (collection_case.owner_user_id = app_current_user_id()))))))));

alter policy audit_events_insert_role_guard on public.audit_events
  with check (app_has_any_permission(ARRAY['account:write'::text, 'billing:write'::text, 'partner:quote:write'::text, 'deal:register'::text, 'billing:approve'::text, 'agreement:approve'::text, 'destructive:approve'::text]));

alter policy commission_accruals_insert_role_guard on public.commission_accruals
  with check (app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text]));

alter policy commission_accruals_update_role_guard on public.commission_accruals
  using (app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text]))
  with check (app_has_any_permission(ARRAY['operations:write'::text, 'billing:approve'::text]));

alter policy guard_i_commitment_entries_3e71e327 on public.commitment_entries
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_commitment_entries_3e71e327 on public.commitment_entries
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_i_commitment_ledgers_6e140599 on public.commitment_ledgers
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_commitment_ledgers_6e140599 on public.commitment_ledgers
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_i_core_amendment_financial_terms_a534e753 on public.core_amendment_financial_terms
  with check (app_has_permission('order:write'::text));

alter policy guard_u_core_amendment_financial_terms_a534e753 on public.core_amendment_financial_terms
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy guard_i_core_amendment_line_supersessions_b1d691c3 on public.core_amendment_line_supersessions
  with check (app_has_permission('order:write'::text));

alter policy guard_u_core_amendment_line_supersessions_b1d691c3 on public.core_amendment_line_supersessions
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy core_billing_policies_finance_read on public.core_billing_policies
  using (app_has_permission('billing:approve'::text));

alter policy core_collection_actions_finance_insert on public.core_collection_actions
  with check ((app_has_permission('billing:approve'::text) AND (actor_user_id = app_current_user_id()) AND (EXISTS ( SELECT 1
   FROM core_collection_cases collection_case
  WHERE (collection_case.id = core_collection_actions.collection_case_id)))));

alter policy core_collection_actions_finance_read on public.core_collection_actions
  using ((app_has_permission('billing:approve'::text) AND (actor_user_id = app_current_user_id())));

alter policy core_collection_cases_finance_insert on public.core_collection_cases
  with check ((app_has_permission('billing:approve'::text) AND (owner_user_id = app_current_user_id()) AND (EXISTS ( SELECT 1
   FROM invoices source_invoice
  WHERE ((source_invoice.id = core_collection_cases.invoice_id) AND (source_invoice.account_id = core_collection_cases.account_id))))));

alter policy core_collection_cases_finance_read on public.core_collection_cases
  using (app_has_permission('billing:approve'::text));

alter policy core_collection_cases_finance_update on public.core_collection_cases
  using (app_has_permission('billing:approve'::text))
  with check ((app_has_permission('billing:approve'::text) AND (EXISTS ( SELECT 1
   FROM invoices source_invoice
  WHERE ((source_invoice.id = core_collection_cases.invoice_id) AND (source_invoice.account_id = core_collection_cases.account_id))))));

alter policy guard_i_core_order_commercial_profiles_02ebcc0c on public.core_order_commercial_profiles
  with check (app_has_permission('order:write'::text));

alter policy guard_u_core_order_commercial_profiles_02ebcc0c on public.core_order_commercial_profiles
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy guard_i_core_order_line_snapshots_54c9c21c on public.core_order_line_snapshots
  with check (app_has_permission('order:write'::text));

alter policy guard_u_core_order_line_snapshots_54c9c21c on public.core_order_line_snapshots
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy core_transfer_tiers_economics_select_guard on public.core_partner_transfer_tiers
  using (app_has_permission('billing:approve'::text));

alter policy core_price_activation_finance_read on public.core_price_book_activation_events
  using (app_has_permission('quote:approve'::text));

alter policy guard_i_core_quote_commercial_profiles_53d0c407 on public.core_quote_commercial_profiles
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_u_core_quote_commercial_profiles_53d0c407 on public.core_quote_commercial_profiles
  using (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]))
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_i_core_quote_snapshots_d56d5619 on public.core_quote_snapshots
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_u_core_quote_snapshots_d56d5619 on public.core_quote_snapshots
  using (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]))
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy core_tax_rates_finance_read on public.core_tax_rates
  using (app_has_permission('billing:approve'::text));

alter policy core_tax_activation_finance_read on public.core_tax_rule_book_activation_events
  using (app_has_permission('billing:approve'::text));

alter policy core_tax_rule_books_finance_read on public.core_tax_rule_books
  using (app_has_permission('billing:approve'::text));

alter policy credit_notes_finance_insert on public.credit_notes
  with check (app_has_permission('billing:approve'::text));

alter policy credit_notes_read on public.credit_notes
  using ((app_has_permission('billing:approve'::text) OR (EXISTS ( SELECT 1
   FROM invoices invoice
  WHERE ((invoice.id = credit_notes.invoice_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_credit_notes_dbe263ee on public.credit_notes
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_credit_notes_dbe263ee on public.credit_notes
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_i_deal_registrations_606b79cc on public.deal_registrations
  with check (app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text]));

alter policy guard_u_deal_registrations_606b79cc on public.deal_registrations
  using (app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text]));

alter policy dispute_cases_finance_insert on public.dispute_cases
  with check (app_has_permission('billing:approve'::text));

alter policy dispute_cases_read on public.dispute_cases
  using ((app_has_permission('billing:approve'::text) OR (EXISTS ( SELECT 1
   FROM (payments payment
     JOIN invoices invoice ON ((invoice.id = payment.invoice_id)))
  WHERE ((payment.id = dispute_cases.payment_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_dispute_cases_7737ddf1 on public.dispute_cases
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_dispute_cases_7737ddf1 on public.dispute_cases
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_i_documents_21f64da1 on public.documents
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_u_documents_21f64da1 on public.documents
  using (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]))
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy entitlements_finance_read on public.entitlements
  using (app_has_permission('billing:approve'::text));

alter policy guard_i_entitlements_86b3bc08 on public.entitlements
  with check (app_has_permission('operations:write'::text));

alter policy guard_u_entitlements_86b3bc08 on public.entitlements
  using (app_has_permission('operations:write'::text))
  with check (app_has_permission('operations:write'::text));

alter policy experience_delivery_read on public.experience_artifact_deliveries
  using ((((audience = 'internal'::text) AND (account_id IS NULL) AND experience_session_is_internal() AND app_has_permission('operations:write'::text) AND (experience_session_assisted_account() IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(audience_account_id))));

alter policy experience_render_insert on public.experience_document_render_requests
  with check ((app_is_current_user(requested_by) AND (((audience = 'internal'::text) AND (account_id IS NULL) AND (audience_account_id IS NULL) AND experience_session_is_internal() AND app_has_permission('operations:write'::text) AND (experience_session_assisted_account() IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(account_id) AND app_has_account(audience_account_id)))));

alter policy experience_render_read on public.experience_document_render_requests
  using ((((audience = 'internal'::text) AND (account_id IS NULL) AND experience_session_is_internal() AND app_has_permission('operations:write'::text) AND (experience_session_assisted_account() IS NULL)) OR ((audience <> 'internal'::text) AND app_has_account(account_id) AND app_has_account(audience_account_id))));

alter policy experience_evidence_insert on public.experience_evidence_uploads
  with check ((app_is_current_user(owner_user_id) AND (app_has_account(account_id) OR (experience_session_is_internal() AND ((experience_session_assisted_account() IS NULL) OR (account_id = experience_session_assisted_account())) AND (((journey = 'exception'::text) AND app_has_permission('operations:write'::text)) OR ((journey = 'approval'::text) AND app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text])))))));

alter policy experience_evidence_read on public.experience_evidence_uploads
  using ((app_is_current_user(owner_user_id) AND (app_has_account(account_id) OR (experience_session_is_internal() AND ((experience_session_assisted_account() IS NULL) OR (account_id = experience_session_assisted_account())) AND (((journey = 'exception'::text) AND app_has_permission('operations:write'::text)) OR ((journey = 'approval'::text) AND app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text])))))));

alter policy experience_projection_read on public.experience_portal_projections
  using ((((audience = 'internal'::text) AND experience_session_is_internal() AND ((experience_session_assisted_account() IS NULL) OR (subject_account_id = experience_session_assisted_account())) AND (((channel = 'approvals'::text) AND app_has_any_permission(ARRAY['agreement:approve'::text, 'quote:approve'::text, 'billing:approve'::text, 'destructive:approve'::text])) OR ((channel <> 'approvals'::text) AND app_has_permission('operations:write'::text)))) OR ((audience <> 'internal'::text) AND app_has_account(audience_account_id) AND ((audience <> 'partner'::text) OR (channel <> ALL (ARRAY['billing'::text, 'commissions'::text, 'renewals'::text, 'sandboxes'::text, 'brand'::text])) OR app_has_permission('account:write'::text) OR (experience_session_is_internal() AND (experience_session_assisted_account() = audience_account_id))))));

alter policy guard_i_inbound_notices_ab0c7a3e on public.inbound_notices
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_u_inbound_notices_ab0c7a3e on public.inbound_notices
  using (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]))
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_i_invites_4a46687a on public.invites
  with check (app_has_permission('account:write'::text));

alter policy guard_u_invites_4a46687a on public.invites
  using (app_has_permission('account:write'::text))
  with check (app_has_permission('account:write'::text));

alter policy guard_i_invoices_56deca22 on public.invoices
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_invoices_56deca22 on public.invoices
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy invoices_finance_read on public.invoices
  using (app_has_permission('billing:approve'::text));

alter policy guard_i_key_terms_e2d758b0 on public.key_terms
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_u_key_terms_e2d758b0 on public.key_terms
  using (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]))
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy lifecycle_offboarding_tenant_update on public.lifecycle_offboarding_plans
  using ((app_is_internal() OR (app_has_account(account_id) AND app_has_permission('destructive:approve'::text))))
  with check ((app_is_internal() OR (app_has_account(account_id) AND app_has_permission('destructive:approve'::text))));

alter policy guard_i_novations_955355ef on public.novations
  with check (app_has_any_permission(ARRAY['account:write'::text, 'agreement:approve'::text]));

alter policy guard_i_order_lines_6e8cec88 on public.order_lines
  with check (app_has_permission('order:write'::text));

alter policy guard_u_order_lines_6e8cec88 on public.order_lines
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy guard_i_orders_12c500ed on public.orders
  with check (app_has_permission('order:write'::text));

alter policy guard_u_orders_12c500ed on public.orders
  using (app_has_permission('order:write'::text))
  with check (app_has_permission('order:write'::text));

alter policy guard_i_organizations_d9811f03 on public.organizations
  with check (app_has_permission('account:write'::text));

alter policy guard_u_organizations_d9811f03 on public.organizations
  using (app_has_permission('account:write'::text))
  with check (app_has_permission('account:write'::text));

alter policy outbox_messages_finance_insert on public.outbox_messages
  with check ((app_has_permission('billing:approve'::text) AND (EXISTS ( SELECT 1
   FROM audit_events finance_event
  WHERE ((finance_event.id = outbox_messages.event_id) AND ((finance_event.actor ->> 'id'::text) = (app_current_user_id())::text))))));

alter policy outbox_messages_insert_role_guard on public.outbox_messages
  with check (app_has_any_permission(ARRAY['account:write'::text, 'billing:write'::text, 'partner:quote:write'::text, 'deal:register'::text, 'billing:approve'::text, 'agreement:approve'::text, 'destructive:approve'::text]));

alter policy guard_i_payments_84d5eaf7 on public.payments
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_payments_84d5eaf7 on public.payments
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy payments_finance_read on public.payments
  using (app_has_permission('billing:approve'::text));

alter policy guard_i_pocs_51925df6 on public.pocs
  with check (app_has_permission('poc:manage'::text));

alter policy guard_u_pocs_51925df6 on public.pocs
  using (app_has_permission('poc:manage'::text))
  with check (app_has_permission('poc:manage'::text));

alter policy price_books_finance_read on public.price_books
  using (app_has_permission('quote:approve'::text));

alter policy guard_i_procurement_profiles_14572dd1 on public.procurement_profiles
  with check (app_has_permission('account:write'::text));

alter policy guard_u_procurement_profiles_14572dd1 on public.procurement_profiles
  using (app_has_permission('account:write'::text))
  with check (app_has_permission('account:write'::text));

alter policy guard_i_quote_lines_bd945660 on public.quote_lines
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_u_quote_lines_bd945660 on public.quote_lines
  using (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]))
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_i_quotes_2150fd65 on public.quotes
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy guard_u_quotes_2150fd65 on public.quotes
  using (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]))
  with check (app_has_any_permission(ARRAY['quote:write'::text, 'partner:quote:write'::text, 'quote:approve'::text]));

alter policy rate_cards_economics_select_guard on public.rate_cards
  using (app_has_permission('quote:approve'::text));

alter policy rate_cards_finance_read on public.rate_cards
  using (app_has_permission('quote:approve'::text));

alter policy guard_i_refunds_0084ff71 on public.refunds
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_refunds_0084ff71 on public.refunds
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy refunds_finance_insert on public.refunds
  with check (app_has_permission('billing:approve'::text));

alter policy refunds_read on public.refunds
  using ((app_has_permission('billing:approve'::text) OR (EXISTS ( SELECT 1
   FROM (payments payment
     JOIN invoices invoice ON ((invoice.id = payment.invoice_id)))
  WHERE ((payment.id = refunds.payment_id) AND app_has_account(invoice.account_id))))));

alter policy guard_i_report_exports_a2ebaa4e on public.report_exports
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy guard_u_report_exports_a2ebaa4e on public.report_exports
  using (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]))
  with check (app_has_any_permission(ARRAY['billing:write'::text, 'billing:approve'::text, 'operations:write'::text]));

alter policy terminations_insert_role_guard on public.terminations
  with check (app_has_permission('account:write'::text));

alter policy terminations_update_role_guard on public.terminations
  using (app_has_permission('system:operate'::text))
  with check (app_has_permission('system:operate'::text));

alter policy guard_i_usage_events_f6c8fb56 on public.usage_events
  with check (app_has_permission('operations:write'::text));

alter policy guard_u_usage_events_f6c8fb56 on public.usage_events
  using (app_has_permission('operations:write'::text))
  with check (app_has_permission('operations:write'::text));

-- ---------------------------------------------------------------------------
-- The three finance confinements, monotone.
-- ---------------------------------------------------------------------------
alter policy audit_events_finance_visibility_guard on public.audit_events
  using (
    app_has_permission('audit:read')
    or actor ->> 'id' = public.app_current_user_id()::text
    or (aggregate_type = 'credit_note' and exists (
      select 1 from public.credit_notes adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type = 'refund' and exists (
      select 1 from public.refunds adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type in ('dispute','dispute_case') and exists (
      select 1 from public.dispute_cases adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type = 'collection_case' and exists (
      select 1 from public.core_collection_cases collection_case
      where collection_case.id = aggregate_id
        and collection_case.owner_user_id = public.app_current_user_id()
    ))
  );

-- Without `audit:append`, a person appends audit rows only under their own
-- user id, on an account they hold or on a finance record (001401).
alter policy audit_events_finance_insert_guard on public.audit_events
  with check (
    app_has_permission('audit:append')
    or (
      actor ->> 'id' = public.app_current_user_id()::text
      and (
        app_has_account(account_id)
        or aggregate_type in (
          'invoice','credit_note','refund','dispute',
          'dispute_case','collection_case','collection_action'
        )
      )
    )
  );

alter policy outbox_messages_finance_insert_guard on public.outbox_messages
  with check (
    app_has_permission('audit:append')
    or exists (
      select 1 from public.audit_events finance_event
      where finance_event.id = event_id
        and finance_event.actor ->> 'id' = public.app_current_user_id()::text
    )
  );

-- ---------------------------------------------------------------------------
-- Functions. Bodies restated from their latest definitions (001000, 001300,
-- 001430, 001441) with only the role tests changed: the approver of record
-- must still hold finance authority through any of their roles, and a
-- customer acquisition request must still come from someone who can buy for
-- the organization (an owner or administrator holds quote:write there).
-- ---------------------------------------------------------------------------
-- public.core_create_stripe_adjustment_operation(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.core_create_stripe_adjustment_operation(candidate_adjustment_id uuid, candidate_kind text, candidate_provider_reason text, candidate_internal_reason_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text := current_setting('role', true);
  existing_operation public.core_stripe_adjustment_operations%rowtype;
  created_operation public.core_stripe_adjustment_operations%rowtype;
  adjustment_order_id uuid;
  adjustment_source_id uuid;
  adjustment_currency text;
  adjustment_amount bigint;
  adjustment_reason text;
  adjustment_version integer;
  adjustment_status text;
  provider_source_id text;
  individual_cap bigint;
  aggregate_cap bigint;
  adjustment_approver uuid;
  payg_invoice_id uuid;
begin
  if caller_role = 'clockwork_runtime' and not (
    public.app_context_is_valid()
    and public.app_has_permission('billing:approve')
  ) then
    raise exception using errcode = '42501', message = 'finance approval is required to create a Stripe adjustment operation';
  end if;
  if candidate_kind not in ('credit_note','refund') then
    raise exception using errcode = '23514', message = 'Stripe adjustment kind is invalid';
  end if;

  select * into existing_operation
  from public.core_stripe_adjustment_operations operation
  where operation.adjustment_id = candidate_adjustment_id
  for update;
  if found then
    if existing_operation.kind is distinct from candidate_kind
      or existing_operation.provider_reason is distinct from candidate_provider_reason
      or existing_operation.internal_reason_code is distinct from candidate_internal_reason_code
    then
      raise exception using errcode = '23505', message = 'Stripe adjustment replay conflicts with the durable operation';
    end if;
    return existing_operation.adjustment_id;
  end if;

  -- Resolve only the immutable order identity first, then take the aggregate
  -- mutex before any source lock. Direct service validation uses the same lock
  -- order, preventing a source/order deadlock under mixed concurrent callers.
  if candidate_kind = 'credit_note' then
    select adjustment.order_id into adjustment_order_id
    from public.credit_notes adjustment
    where adjustment.id = candidate_adjustment_id;
  else
    select adjustment.order_id into adjustment_order_id
    from public.refunds adjustment
    where adjustment.id = candidate_adjustment_id;
  end if;
  if adjustment_order_id is null then
    payg_invoice_id := public.core_lock_payg_adjustment(candidate_adjustment_id,candidate_kind);
    if payg_invoice_id is null then
      raise exception using errcode='23514',message='Stripe adjustment source is missing its persisted provider binding';
    end if;
  else
    perform 1 from public.orders source_order where source_order.id=adjustment_order_id for update;
  end if;

  if candidate_kind = 'credit_note' then
    select adjustment.order_id, adjustment.invoice_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, adjustment.approved_by,
      source_invoice.stripe_invoice_id, source_invoice.amount_minor,
      source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, adjustment_approver,
      provider_source_id, individual_cap, aggregate_cap
    from public.credit_notes adjustment
    join public.invoices source_invoice on source_invoice.id = adjustment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_invoice;
    if caller_role = 'clockwork_runtime'
      and adjustment_approver is distinct from public.app_current_user_id()
    then
      raise exception using errcode = '42501', message = 'finance user must own the approved credit note';
    end if;
  else
    select adjustment.order_id, adjustment.payment_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, source_payment.stripe_payment_intent_id,
      source_payment.amount_minor, source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, provider_source_id, individual_cap, aggregate_cap
    from public.refunds adjustment
    join public.payments source_payment on source_payment.id = adjustment.payment_id
    join public.invoices source_invoice on source_invoice.id = source_payment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_payment, source_invoice;
  end if;

  if adjustment_source_id is null or provider_source_id is null then
    raise exception using errcode = '23514', message = 'Stripe adjustment source is missing its persisted provider binding';
  end if;
  if adjustment_status <> 'approved' then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation requires an approved local adjustment';
  end if;
  if candidate_internal_reason_code is distinct from adjustment_reason then
    raise exception using errcode = '23514', message = 'Stripe adjustment internal reason must match the approved adjustment';
  end if;

  insert into public.core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,provider_payment_intent_id,amount_minor,
    individual_cap_minor,aggregate_cap_minor,provider_reason,
    internal_reason_code,provider_idempotency_key,command_version
  ) values (
    candidate_adjustment_id,candidate_kind,adjustment_order_id,
    adjustment_source_id,adjustment_currency,
    case when candidate_kind = 'credit_note' then provider_source_id end,
    case when candidate_kind = 'refund' then provider_source_id end,
    adjustment_amount,individual_cap,aggregate_cap,candidate_provider_reason,
    adjustment_reason,'stripe-adjustment:' || candidate_adjustment_id::text,
    adjustment_version
  )
  returning * into created_operation;
  return created_operation.adjustment_id;
end
$function$;

-- public.core_reserve_order_acceptance(uuid,integer,uuid,text)
CREATE OR REPLACE FUNCTION public.core_reserve_order_acceptance(candidate_order_id uuid, candidate_expected_order_version integer, candidate_review_owner_user_id uuid, candidate_request_id text)
 RETURNS core_order_acceptance_reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  order_record public.orders%rowtype;
  quote_record public.quotes%rowtype;
  order_profile public.core_order_commercial_profiles%rowtype;
  quote_profile public.core_quote_commercial_profiles%rowtype;
  billing_profile public.core_account_commercial_profiles%rowtype;
  partner_profile public.core_account_commercial_profiles%rowtype;
  billing_policy public.core_billing_policies%rowtype;
  partner_policy public.core_billing_policies%rowtype;
  existing_reservation public.core_order_acceptance_reservations%rowtype;
  review_id uuid;
  rejection_reason text;
  inserted_reservation public.core_order_acceptance_reservations%rowtype;
begin
  if current_setting('role', true) = 'clockwork_runtime' and not (
    public.app_context_is_valid()
    and public.app_has_permission('order:write')
  ) then
    raise exception using errcode = '42501', message = 'order acceptance requires a signed authorized actor';
  end if;
  if candidate_expected_order_version <= 0
    or nullif(trim(candidate_request_id), '') is null
  then
    raise exception using errcode = '22023', message = 'order version and request identity are required';
  end if;
  if not exists (
    select 1 from public.commerce_users user_record
    where user_record.id = candidate_review_owner_user_id
      and user_record.is_internal_staff
  ) then
    raise exception using errcode = '23514', message = 'order rejection review requires an internal owner';
  end if;

  select * into order_record
  from public.orders
  where id = candidate_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order not found';
  end if;
  if current_setting('role', true) = 'clockwork_runtime' and not (
    public.app_is_internal()
    or (
      order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id = order_record.invoicing_account_id
      and public.app_has_account(order_record.invoicing_account_id)
    )
    or (
      order_record.sourcing not in ('resale','distributor')
      and public.app_has_account(order_record.account_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'order acceptance actor is outside the persisted party chain';
  end if;
  if order_record.row_version <> candidate_expected_order_version then
    raise exception using errcode = '40001', message = 'stale order acceptance version';
  end if;
  if order_record.status not in ('submitted','accepted') then
    raise exception using errcode = '23514', message = 'only submitted or accepted orders may reserve acceptance';
  end if;
  select * into quote_record
  from public.quotes where id = order_record.quote_id for update;
  select * into order_profile
  from public.core_order_commercial_profiles
  where order_id = order_record.id;
  select * into quote_profile
  from public.core_quote_commercial_profiles
  where quote_id = quote_record.id;

  select * into existing_reservation
  from public.core_order_acceptance_reservations
  where order_id = order_record.id
  for update;
  if found and existing_reservation.decision <> 'released' then
    return existing_reservation;
  end if;

  perform 1
  from public.core_account_commercial_profiles commercial_profile
  where commercial_profile.account_id = any(array_remove(array[
    order_record.invoicing_account_id,
    order_record.partner_account_id
  ]::uuid[], null))
  order by commercial_profile.account_id
  for update;
  perform 1
  from public.core_billing_policies policy_record
  where policy_record.account_id = any(array_remove(array[
    order_record.invoicing_account_id,
    order_record.partner_account_id
  ]::uuid[], null))
  order by policy_record.account_id
  for update;

  select * into billing_profile
  from public.core_account_commercial_profiles
  where account_id = order_record.invoicing_account_id;
  select * into billing_policy
  from public.core_billing_policies
  where account_id = order_record.invoicing_account_id;
  if order_record.partner_account_id is not null then
    select * into partner_profile
    from public.core_account_commercial_profiles
    where account_id = order_record.partner_account_id;
    select * into partner_policy
    from public.core_billing_policies
    where account_id = order_record.partner_account_id;
  end if;

  if not public.system_capability_is_enabled('new_business')
    or not public.system_capability_is_enabled('legal')
    or not public.system_capability_is_enabled('billing')
    or (order_record.sourcing in ('referral','resale','distributor')
      and not public.system_capability_is_enabled('partner'))
    or (order_record.sourcing = 'marketplace'
      and not public.system_capability_is_enabled('marketplace'))
  then
    rejection_reason := 'software_capability_blocked';
  elsif quote_record.status <> 'accepted'
    or quote_record.total_minor <= 0
    or quote_profile.quote_id is null
    or order_profile.order_id is null
    or order_profile.billing_shape <> order_record.sourcing
    or quote_profile.channel_shape <> order_record.sourcing
  then
    rejection_reason := 'authoritative_commercial_state_missing';
  elsif order_profile.buyer_agreement_id is null
    or (
      order_record.partner_account_id is not null
      and order_profile.partner_agreement_id is null
    )
  then
    rejection_reason := 'authoritative_agreement_missing';
  elsif billing_profile.account_id is null
    or billing_policy.account_id is null
    or (
      order_record.partner_account_id is not null
      and (partner_profile.account_id is null or partner_policy.account_id is null)
    )
  then
    rejection_reason := 'authoritative_payment_policy_missing';
  elsif billing_profile.new_service_blocked
    or (order_record.partner_account_id is not null
      and partner_profile.new_service_blocked)
  then
    rejection_reason := 'new_service_blocked';
  elsif quote_record.currency <> (
    select billing_account.currency from public.accounts billing_account
    where billing_account.id = order_record.invoicing_account_id
  )
  then
    rejection_reason := 'source_currency_mismatch';
  elsif billing_profile.billing_model = 'net_terms' and (
    billing_profile.credit_status <> 'approved'
    or billing_profile.current_exposure_minor + quote_record.total_minor
      > billing_profile.approved_credit_limit_minor
  ) then
    rejection_reason := 'billing_credit_unavailable';
  elsif order_record.partner_account_id is not null
    and order_record.partner_account_id <> order_record.invoicing_account_id
    and partner_profile.billing_model = 'net_terms' and (
      partner_profile.credit_status <> 'approved'
      or partner_profile.current_exposure_minor + quote_record.total_minor
        > partner_profile.approved_credit_limit_minor
    )
  then
    rejection_reason := 'partner_credit_unavailable';
  end if;

  if rejection_reason is not null then
    insert into public.exception_cases (
      account_id, queue, object_type, object_id, owner_user_id,
      target_at, status, decision_reason
    ) values (
      order_record.invoicing_account_id, 'order_acceptance_review',
      'order', order_record.id, candidate_review_owner_user_id,
      clock_timestamp(), 'open', rejection_reason
    )
    on conflict (object_type, object_id)
      where queue = 'order_acceptance_review'
        and status in ('open','under_review')
    do update set
      owner_user_id = excluded.owner_user_id,
      decision_reason = excluded.decision_reason,
      updated_at = clock_timestamp()
    returning id into review_id;

    if existing_reservation.order_id is null then
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, partner_account_id,
        currency, amount_minor, decision, reason, owner_user_id,
        review_case_id
      ) values (
        order_record.id, order_record.account_id,
        order_record.invoicing_account_id, order_record.partner_account_id,
        quote_record.currency, quote_record.total_minor, 'rejected',
        rejection_reason, candidate_review_owner_user_id, review_id
      ) returning * into inserted_reservation;
    else
      update public.core_order_acceptance_reservations
      set decision = 'rejected', reason = rejection_reason,
        owner_user_id = candidate_review_owner_user_id,
        review_case_id = review_id,
        released_by_user_id = null, released_at = null,
        release_reason = null, updated_at = clock_timestamp()
      where order_id = order_record.id
      returning * into inserted_reservation;
    end if;
    return inserted_reservation;
  end if;

  update public.core_account_commercial_profiles
  set current_exposure_minor = current_exposure_minor + quote_record.total_minor
  where account_id = order_record.invoicing_account_id;
  if order_record.partner_account_id is not null
    and order_record.partner_account_id <> order_record.invoicing_account_id
  then
    update public.core_account_commercial_profiles
    set current_exposure_minor = current_exposure_minor + quote_record.total_minor
    where account_id = order_record.partner_account_id;
  end if;

  if existing_reservation.order_id is null then
    insert into public.core_order_acceptance_reservations (
      order_id, buyer_account_id, billing_account_id, partner_account_id,
      currency, amount_minor, decision, reason
    ) values (
      order_record.id, order_record.account_id,
      order_record.invoicing_account_id, order_record.partner_account_id,
      quote_record.currency, quote_record.total_minor,
      'approved', 'authoritative_checks_passed'
    ) returning * into inserted_reservation;
  else
    update public.core_order_acceptance_reservations
    set decision = 'approved', reason = 'authoritative_checks_passed',
      released_by_user_id = null, released_at = null,
      release_reason = null, updated_at = clock_timestamp()
    where order_id = order_record.id
    returning * into inserted_reservation;
  end if;
  return inserted_reservation;
end
$function$;

-- public.validate_payg_credit_source()
CREATE OR REPLACE FUNCTION public.validate_payg_credit_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  credit public.credit_notes%rowtype;
  invoice public.invoices%rowtype;
  invoice_source public.core_payg_invoice_sources%rowtype;
  effect public.core_payg_pending_invoice_effects%rowtype;
  revision public.core_payg_period_revisions%rowtype;
  prior_total bigint;
  prior_net bigint;
  prior_tax bigint;
  original_net bigint;
  expected_tax bigint;
  allocated_net bigint;
  expected_source jsonb;
begin
  select * into credit from public.credit_notes where id=new.credit_note_id;
  select * into invoice from public.invoices where id=new.invoice_id for update;
  select * into invoice_source from public.core_payg_invoice_sources where invoice_id=new.invoice_id;
  select * into effect from public.core_payg_pending_invoice_effects where idempotency_key=new.effect_key for update;
  select * into revision from public.core_payg_period_revisions rated where rated.enrollment_id=effect.enrollment_id
    and rated.month=effect.payload->>'month' and rated.revision=(effect.payload->>'revision')::integer;
  select (previous.snapshot#>>'{rating,total,minor}')::bigint into prior_total
    from public.core_payg_period_revisions previous where previous.enrollment_id=revision.enrollment_id
      and previous.month=revision.month and previous.revision=revision.revision-1;
  if credit.id is null or invoice.id is null or invoice.billing_source <> 'payg' or invoice_source.invoice_id is null
    or credit.invoice_id is distinct from new.invoice_id or credit.order_id is not null
    or credit.currency is distinct from invoice.currency or credit.amount_minor is distinct from new.amount_minor
    or effect.enrollment_id is distinct from invoice_source.enrollment_id
    or effect.payload->>'kind' is distinct from 'credit_adjustment'
    or effect.payload->>'idempotencyKey' is distinct from new.effect_key
    or effect.payload->>'accountId' is distinct from invoice.account_id::text
    or effect.payload#>>'{amount,currency}' is distinct from invoice.currency
    or effect.payload->>'month' is distinct from invoice_source.source_snapshot#>>'{effect,month}'
    or effect.payload->>'originalInvoiceKey' is distinct from invoice_source.source_snapshot#>>'{effect,originalInvoiceKey}'
    or revision.snapshot#>'{rating,policy}' is distinct from invoice_source.source_snapshot#>'{rating,policy}'
    or revision.snapshot#>'{rating,binding}' is distinct from invoice_source.source_snapshot#>'{rating,binding}'
    or effect.payload->>'ratingEvidenceHash' is distinct from revision.snapshot#>>'{rating,evidenceHash}'
    or prior_total is null or prior_total <= (revision.snapshot#>>'{rating,total,minor}')::bigint
    or (effect.payload#>>'{amount,minor}')::bigint is distinct from prior_total-(revision.snapshot#>>'{rating,total,minor}')::bigint
    or not exists (select 1 from public.commerce_users staff
      where staff.id=credit.approved_by and staff.is_internal_staff and staff.mfa_enrolled and public.member_has_permission(staff.id,'billing:approve'))
  then raise exception using errcode='23514',message='PAYG credit must allocate its retained negative correction to an authorized invoice'; end if;
  select coalesce(sum(net_minor),0),coalesce(sum(tax_minor),0) into prior_net,prior_tax
    from public.core_payg_credit_sources where invoice_id=new.invoice_id;
  original_net := invoice.amount_minor-invoice.tax_minor;
  if original_net <= 0 or prior_net+new.net_minor > original_net then
    raise exception using errcode='23514',message='PAYG credit net exceeds the remaining invoiced net';
  end if;
  expected_tax := floor(((prior_net+new.net_minor)::numeric*invoice.tax_minor*2+original_net)/(original_net::numeric*2))::bigint-prior_tax;
  if expected_tax is distinct from new.tax_minor or prior_tax+new.tax_minor > invoice.tax_minor then
    raise exception using errcode='23514',message='PAYG credit tax must equal the cumulative share of its original invoice tax';
  end if;
  select coalesce(sum(net_minor),0) into allocated_net from public.core_payg_credit_sources where effect_key=new.effect_key;
  if allocated_net+new.net_minor > (effect.payload#>>'{amount,minor}')::bigint then
    raise exception using errcode='23514',message='PAYG credit allocation exceeds its correction effect';
  end if;
  expected_source := jsonb_build_object('effect',effect.payload,'invoiceSourceHash',invoice_source.source_hash,
    'netMinor',new.net_minor::text,'taxMinor',new.tax_minor::text,'amountMinor',new.amount_minor::text);
  if new.source_snapshot is distinct from expected_source or new.source_hash is distinct from
    encode(extensions.digest(convert_to(private.canonical_jsonb_text(expected_source),'UTF8'),'sha256'),'hex') then
    raise exception using errcode='23514',message='PAYG credit immutable source or canonical hash mismatch';
  end if;
  return new;
end $function$;

-- public.guard_customer_acquisition_request()
CREATE OR REPLACE FUNCTION public.guard_customer_acquisition_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 offer public.core_payg_offer_versions%rowtype;
 org public.organizations%rowtype;
 trial public.core_trial_claims%rowtype;
 enrollment public.core_payg_enrollments%rowtype;
 command jsonb; notices jsonb; reference jsonb;
begin
 if tg_op='DELETE' then raise exception 'ACQUISITION_IMMUTABLE'; end if;
 if tg_op='INSERT' then
  select * into org from public.organizations where id=new.organization_id for share;
  if not found or org.account_id<>new.account_id or not public.member_has_permission(new.requested_by,'quote:write',new.organization_id) then raise exception 'ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED'; end if;
  select * into offer from public.core_payg_offer_versions where id=new.offer_version_id for share;
  if not found or new.status<>'pending' or new.row_version<>1 or new.resolved_by is not null or new.resolution_reason is not null then raise exception 'ACQUISITION_INVALID_INITIAL_STATE'; end if;
  command:=new.snapshot->'command'; notices:=offer.terms->'customerAcquisition';
  if new.snapshot->'terms' is distinct from offer.terms or command->>'id' is distinct from new.id::text or command->>'accountId' is distinct from new.account_id::text or command->>'organizationId' is distinct from new.organization_id::text or command->>'kind' is distinct from new.kind or new.snapshot#>>'{offer,id}' is distinct from offer.id::text or new.snapshot#>>'{offer,fingerprint}' is distinct from encode(extensions.digest(convert_to(private.canonical_jsonb_text(offer.terms),'UTF8'),'sha256'),'hex') then raise exception 'ACQUISITION_SNAPSHOT_MISMATCH'; end if;
  if new.snapshot->'offer' is distinct from jsonb_build_object('id',offer.id::text,'rowVersion',offer.row_version,'fingerprint',encode(extensions.digest(convert_to(private.canonical_jsonb_text(offer.terms),'UTF8'),'sha256'),'hex'),'name',offer.terms->>'name','sku',offer.terms->>'sku','region',offer.terms->>'region','version',offer.terms->'version','effectiveFrom',offer.terms->>'effectiveFrom','currency',offer.terms#>>'{payg,currency}','storageTbMonthMinor',offer.terms#>>'{payg,storageTbMonthMinor}','monthlyMinimumMinor',offer.terms#>>'{payg,monthlyMinimumMinor}','partialMonthMinimum',offer.terms#>>'{payg,partialMonthMinimum}','trial',offer.terms->'trial','notices',notices) then raise exception 'ACQUISITION_PUBLIC_OFFER_MISMATCH'; end if;
  if new.request_hash is distinct from encode(extensions.digest(convert_to(private.canonical_jsonb_text(jsonb_build_object('command',command,'userId',new.requested_by::text)),'UTF8'),'sha256'),'hex') then raise exception 'ACQUISITION_REQUEST_HASH_MISMATCH'; end if;
  if jsonb_typeof(notices) is distinct from 'object' or not (notices ?& array['serviceNotice','cancellationNotice','trialNotice','terms','retention']) or jsonb_typeof(notices->'serviceNotice') is distinct from 'string' or jsonb_typeof(notices->'cancellationNotice') is distinct from 'string' or jsonb_typeof(notices->'trialNotice') is distinct from 'string' or coalesce(length(trim(notices->>'serviceNotice')),0)<20 or coalesce(length(trim(notices->>'cancellationNotice')),0)<20 or coalesce(length(trim(notices->>'trialNotice')),0)<20 or notices#>>'{terms,sha256}' is null or notices#>>'{terms,sha256}' !~ '^[a-f0-9]{64}$' or notices#>>'{retention,sha256}' is null or notices#>>'{retention,sha256}' !~ '^[a-f0-9]{64}$' then raise exception 'ACQUISITION_CUSTOMER_NOTICES_REQUIRED'; end if;
  for reference in select value from jsonb_array_elements(jsonb_build_array(notices->'terms',notices->'retention')) loop
   if jsonb_typeof(reference) is distinct from 'object' or not (reference ?& array['documentId','version','uri','sha256']) or coalesce(length(trim(reference->>'documentId')),0)=0 or coalesce(length(trim(reference->>'version')),0)=0 or jsonb_typeof(reference->'uri') is distinct from 'string' or reference->>'uri' !~ '^https://[^/?#@]+(/[^?#]*)?$' then raise exception 'ACQUISITION_CUSTOMER_NOTICES_REQUIRED'; end if;
  end loop;
  if new.kind='cancel_payg' then
   select * into enrollment from public.core_payg_enrollments where id=new.enrollment_id for share;
   if not found or command->>'enrollmentId' is distinct from enrollment.id::text or enrollment.account_id<>new.account_id or enrollment.offer_version_id<>offer.id or enrollment.snapshot#>>'{binding,tenantId}' is distinct from org.external_provisioning_id or enrollment.snapshot->>'endsAt' is not null then raise exception 'ACQUISITION_ENROLLMENT_MISMATCH'; end if;
  else
   if offer.status<>'approved' or offer.approval_evidence_id is null or (offer.terms->>'effectiveFrom')::date>(new.created_at at time zone 'UTC')::date or command->>'offerVersionId' is distinct from offer.id::text or command->>'offerRowVersion' is distinct from offer.row_version::text or command->>'offerFingerprint' is distinct from new.snapshot#>>'{offer,fingerprint}' or command->'acceptedTerms' is distinct from 'true'::jsonb then raise exception 'ACQUISITION_APPROVED_ASSENT_REQUIRED'; end if;
   if (new.kind='trial' and notices->'trialRequestsEnabled' is distinct from 'true'::jsonb) or (new.kind<>'trial' and notices->'paygRequestsEnabled' is distinct from 'true'::jsonb) then raise exception 'ACQUISITION_KIND_UNAVAILABLE'; end if;
   if new.kind='convert_to_payg' then
    select * into trial from public.core_trial_claims where id=new.trial_id for share;
    if not found or trial.account_id<>new.account_id or trial.organization_id<>new.organization_id or trial.snapshot->>'convertedAt' is not null or command->>'trialId' is distinct from trial.id::text then raise exception 'ACQUISITION_TRIAL_MISMATCH'; end if;
   elsif new.trial_id is not null or new.enrollment_id is not null then raise exception 'ACQUISITION_INVALID_INITIAL_STATE'; end if;
  end if;
  return new;
 end if;
 if old.status<>'pending' or new.status not in ('fulfilled','declined') or new.row_version<>old.row_version+1 or new.id<>old.id or new.account_id<>old.account_id or new.organization_id<>old.organization_id or new.requested_by<>old.requested_by or new.kind<>old.kind or new.offer_version_id<>old.offer_version_id or new.request_hash<>old.request_hash or new.snapshot is distinct from old.snapshot or new.created_at<>old.created_at then raise exception 'ACQUISITION_IMMUTABLE'; end if;
 if not exists(select 1 from public.commerce_users u where u.id=new.resolved_by and u.is_internal_staff and u.mfa_enrolled and public.member_has_permission(u.id,'quote:approve')) then raise exception 'ACQUISITION_FINANCE_REQUIRED'; end if;
 if new.status='declined' then
  if new.trial_id is distinct from old.trial_id or new.enrollment_id is distinct from old.enrollment_id then raise exception 'ACQUISITION_DECLINE_CANNOT_BIND'; end if;
  return new;
 end if;
 select * into org from public.organizations where id=new.organization_id for share;
 if org.account_id is distinct from new.account_id or org.external_provisioning_id is null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 if new.kind='trial' then
  select * into trial from public.core_trial_claims where id=new.trial_id for share;
  if not found or trial.account_id<>new.account_id or trial.organization_id<>new.organization_id or trial.offer_version_id<>new.offer_version_id or (trial.snapshot->>'startsAt')::timestamptz<new.created_at or trial.snapshot->>'tenantId' is distinct from org.external_provisioning_id or new.enrollment_id is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 else
  select * into enrollment from public.core_payg_enrollments where id=new.enrollment_id for share;
  if not found or enrollment.account_id<>new.account_id or enrollment.offer_version_id<>new.offer_version_id or enrollment.snapshot#>>'{binding,tenantId}' is distinct from org.external_provisioning_id or enrollment.snapshot->>'billingAuthority' is distinct from 'clockwork' or nullif(enrollment.snapshot->>'cutoverEvidenceId','') is null or (enrollment.snapshot->>'startsAt')::timestamptz>new.updated_at then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
  if new.kind<>'cancel_payg' and (enrollment.snapshot->>'startsAt')::timestamptz<new.created_at then raise exception 'ACQUISITION_SERVICE_PREDATES_ASSENT'; end if;
  if new.kind='cancel_payg' then
   if new.enrollment_id is distinct from old.enrollment_id or enrollment.snapshot->>'endsAt' is null or (enrollment.snapshot->>'endsAt')::timestamptz>new.updated_at or enrollment.cancellation_evidence_id is null then raise exception 'ACQUISITION_CONFIRMED_CANCELLATION_REQUIRED'; end if;
  elsif enrollment.snapshot->>'endsAt' is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
  if new.kind='convert_to_payg' then
   select * into trial from public.core_trial_claims where id=old.trial_id for share;
   if not found or new.trial_id is distinct from old.trial_id or trial.organization_id<>new.organization_id or trial.account_id<>new.account_id or trial.snapshot->>'paidPaygEnrollmentId' is distinct from enrollment.id::text or trial.snapshot->>'convertedAt' is null or (trial.snapshot->>'convertedAt')::timestamptz<new.created_at then raise exception 'ACQUISITION_CONFIRMED_CONVERSION_REQUIRED'; end if;
  elsif new.trial_id is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 end if;
 return new;
end $function$;

-- ---------------------------------------------------------------------------
-- No policy or function tests a role name any more. Dropping the helpers
-- fails this migration if one still did.
-- ---------------------------------------------------------------------------
drop function public.app_has_role(text);
drop function public.app_has_any_role(text[]);
drop function public.experience_session_has_role(text);

comment on function public.experience_session_is_internal() is
  'True for every internal staff claim, including the revenue role. Policies must test permissions (app_has_permission), never internal status alone.';
