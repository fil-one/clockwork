CREATE TABLE "core_commercial_artifact_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"commercial_account_id" uuid NOT NULL,
	"audience_account_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"document_kind" text NOT NULL,
	"source_definition" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"document_id" uuid,
	"content_hash" text,
	"storage_version_id" text,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_commercial_artifact_subject_check" CHECK ("core_commercial_artifact_requests"."subject_type" in ('quote','order','amendment')),
	CONSTRAINT "core_commercial_artifact_audience_check" CHECK ("core_commercial_artifact_requests"."audience" in ('end_client','partner')),
	CONSTRAINT "core_commercial_artifact_kind_check" CHECK ("core_commercial_artifact_requests"."document_kind" in ('direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment')),
	CONSTRAINT "core_commercial_artifact_hash_check" CHECK ("core_commercial_artifact_requests"."source_hash" ~ '^[a-f0-9]{64}$' and "core_commercial_artifact_requests"."request_hash" ~ '^[a-f0-9]{64}$' and ("core_commercial_artifact_requests"."content_hash" is null or "core_commercial_artifact_requests"."content_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "core_commercial_artifact_state_check" CHECK (("core_commercial_artifact_requests"."status" = 'requested' and "core_commercial_artifact_requests"."document_id" is null and "core_commercial_artifact_requests"."content_hash" is null and "core_commercial_artifact_requests"."storage_version_id" is null) or ("core_commercial_artifact_requests"."status" = 'stored' and "core_commercial_artifact_requests"."document_id" is not null and "core_commercial_artifact_requests"."content_hash" is not null and "core_commercial_artifact_requests"."storage_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "core_account_commercial_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_fingerprint" text NOT NULL,
	"billing_model" text DEFAULT 'auto_charge' NOT NULL,
	"payment_terms_days" integer,
	"credit_status" text DEFAULT 'not_requested' NOT NULL,
	"approved_credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"current_exposure_minor" bigint DEFAULT 0 NOT NULL,
	"new_service_blocked" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"collections_owner_id" uuid,
	"contractual_time_zone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_account_fingerprint_check" CHECK ("core_account_commercial_profiles"."legal_entity_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "core_account_billing_model_check" CHECK ("core_account_commercial_profiles"."billing_model" in ('prepay','auto_charge','net_terms')),
	CONSTRAINT "core_account_terms_check" CHECK (("core_account_commercial_profiles"."billing_model" = 'net_terms' and "core_account_commercial_profiles"."payment_terms_days" between 1 and 365) or ("core_account_commercial_profiles"."billing_model" <> 'net_terms' and "core_account_commercial_profiles"."payment_terms_days" is null)),
	CONSTRAINT "core_account_credit_amounts_check" CHECK ("core_account_commercial_profiles"."approved_credit_limit_minor" >= 0 and "core_account_commercial_profiles"."current_exposure_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core_account_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text NOT NULL,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"receives_invoices" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_account_contacts_kind_check" CHECK ("core_account_contacts"."kind" in ('billing','accounts_payable','remit_to','tax','procurement','commercial','technical'))
);
--> statement-breakpoint
CREATE TABLE "core_account_relationship_roles" (
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"source" text DEFAULT 'self_declared' NOT NULL,
	"effective_from" date DEFAULT now() NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_account_relationship_roles_account_id_role_pk" PRIMARY KEY("account_id","role"),
	CONSTRAINT "core_account_relationship_role_check" CHECK ("core_account_relationship_roles"."role" in ('direct_client','partner','end_client')),
	CONSTRAINT "core_account_relationship_dates_check" CHECK ("core_account_relationship_roles"."effective_to" is null or "core_account_relationship_roles"."effective_to" >= "core_account_relationship_roles"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "core_account_tax_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"type" text NOT NULL,
	"normalized_value" text NOT NULL,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"verification_reference" text,
	"reverse_charge_eligible" boolean DEFAULT false NOT NULL,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_tax_identifier_status_check" CHECK ("core_account_tax_identifiers"."validation_status" in ('pending','valid','invalid','expired'))
);
--> statement-breakpoint
CREATE TABLE "core_accounting_export_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"export_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"description" text NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"service_period_starts_on" date,
	"service_period_ends_on" date,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_accounting_entry_sided_check" CHECK ("core_accounting_export_entries"."debit_minor" >= 0 and "core_accounting_export_entries"."credit_minor" >= 0 and (("core_accounting_export_entries"."debit_minor" = 0) <> ("core_accounting_export_entries"."credit_minor" = 0)))
);
--> statement-breakpoint
CREATE TABLE "core_accounting_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"export_type" text NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"currency" text NOT NULL,
	"adapter" text DEFAULT 'qbo_neutral' NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"total_debit_minor" bigint NOT NULL,
	"total_credit_minor" bigint NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_accounting_exports_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "core_accounting_export_balance_check" CHECK ("core_accounting_exports"."total_debit_minor" = "core_accounting_exports"."total_credit_minor"),
	CONSTRAINT "core_accounting_export_type_check" CHECK ("core_accounting_exports"."export_type" in ('ar_issuance','payout_summary','deferred_revenue','commission_bill','tax_liability','cost_summary'))
);
--> statement-breakpoint
CREATE TABLE "core_amendment_financial_terms" (
	"amendment_id" uuid PRIMARY KEY NOT NULL,
	"contractual_time_zone" text NOT NULL,
	"proration_convention" text NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"billable_numerator" integer NOT NULL,
	"billable_denominator" integer NOT NULL,
	"currency" text NOT NULL,
	"forecast_delta_minor" bigint NOT NULL,
	"monthly_delta_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_amendment_proration_check" CHECK ("core_amendment_financial_terms"."proration_convention" in ('actual_actual','actual_365','thirty_360','none') and "core_amendment_financial_terms"."billable_numerator" >= 0 and "core_amendment_financial_terms"."billable_denominator" > 0 and "core_amendment_financial_terms"."billable_numerator" <= "core_amendment_financial_terms"."billable_denominator"),
	CONSTRAINT "core_amendment_period_check" CHECK ("core_amendment_financial_terms"."period_ends_on" >= "core_amendment_financial_terms"."period_starts_on")
);
--> statement-breakpoint
CREATE TABLE "core_amendment_line_supersessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amendment_id" uuid NOT NULL,
	"superseded_order_line_id" uuid NOT NULL,
	"replacement_snapshot" jsonb NOT NULL,
	"effective_on" date NOT NULL,
	"net_quantity_delta" numeric(38, 18) NOT NULL,
	"net_revenue_delta_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_billing_policies" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"collection_method" text NOT NULL,
	"payment_rail" text NOT NULL,
	"terms_days" integer,
	"consolidate_partner_invoices" boolean DEFAULT false NOT NULL,
	"dunning_policy_version" text NOT NULL,
	"require_po" boolean DEFAULT false NOT NULL,
	"require_vendor_setup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_billing_policy_collection_check" CHECK ("core_billing_policies"."collection_method" in ('prepay','auto_charge','net_terms')),
	CONSTRAINT "core_billing_policy_rail_check" CHECK ("core_billing_policies"."payment_rail" in ('card','ach_debit','wire','sepa_credit','bacs','marketplace')),
	CONSTRAINT "core_billing_policy_terms_check" CHECK (("core_billing_policies"."collection_method" = 'net_terms' and "core_billing_policies"."terms_days" between 1 and 365) or ("core_billing_policies"."collection_method" <> 'net_terms' and "core_billing_policies"."terms_days" is null))
);
--> statement-breakpoint
CREATE TABLE "core_collection_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_case_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_collection_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"aging_bucket" text NOT NULL,
	"next_action_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"new_service_blocked" boolean DEFAULT false NOT NULL,
	"running_service_decision" text DEFAULT 'continue' NOT NULL,
	"maximum_retention_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_collection_cases_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "core_collection_status_check" CHECK ("core_collection_cases"."status" in ('open','promised','escalated','resolved','written_off')),
	CONSTRAINT "core_collection_service_decision_check" CHECK ("core_collection_cases"."running_service_decision" in ('continue','human_review','suspend_write'))
);
--> statement-breakpoint
CREATE TABLE "core_commission_settlement_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"export_key" text NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"document_id" uuid,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_commission_settlement_exports_export_key_unique" UNIQUE("export_key")
);
--> statement-breakpoint
CREATE TABLE "core_commission_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"accrual_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"net_collected_revenue_minor" bigint NOT NULL,
	"commission_minor" bigint NOT NULL,
	"holdback_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_commission_statement_lines_accrual_id_unique" UNIQUE("accrual_id"),
	CONSTRAINT "core_commission_statement_line_source_check" CHECK ("core_commission_statement_lines"."source_type" in ('payment','credit_note','refund','dispute'))
);
--> statement-breakpoint
CREATE TABLE "core_commission_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_account_id" uuid NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"currency" text NOT NULL,
	"gross_accrued_minor" bigint NOT NULL,
	"clawback_minor" bigint NOT NULL,
	"holdback_minor" bigint NOT NULL,
	"payable_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_commission_statement_total_check" CHECK ("core_commission_statements"."payable_minor" = "core_commission_statements"."gross_accrued_minor" - "core_commission_statements"."clawback_minor" - "core_commission_statements"."holdback_minor"),
	CONSTRAINT "core_commission_statement_period_check" CHECK ("core_commission_statements"."period_ends_on" >= "core_commission_statements"."period_starts_on"),
	CONSTRAINT "core_commission_statement_status_check" CHECK ("core_commission_statements"."status" in ('draft','issued','approved','exported','paid','void'))
);
--> statement-breakpoint
CREATE TABLE "core_commitment_ledger_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"period_id" uuid,
	"reverses_entry_id" uuid,
	"quantity_delta" numeric(38, 18) NOT NULL,
	"overage_delta" numeric(38, 18) NOT NULL,
	"reason_code" text NOT NULL,
	"source_reference" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_commitment_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"contractual_time_zone" text NOT NULL,
	"allowance_quantity" numeric(38, 18) NOT NULL,
	"consumed_quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"overage_quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"contracted_overage_rate_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_commitment_period_bounds_check" CHECK ("core_commitment_periods"."ends_at" > "core_commitment_periods"."starts_at" and "core_commitment_periods"."sequence" > 0),
	CONSTRAINT "core_commitment_period_quantities_check" CHECK ("core_commitment_periods"."allowance_quantity" >= 0 and "core_commitment_periods"."consumed_quantity" >= 0 and "core_commitment_periods"."overage_quantity" >= 0 and "core_commitment_periods"."contracted_overage_rate_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core_deal_registration_attributions" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"attribution" text NOT NULL,
	"influence_bps" integer NOT NULL,
	"decision_basis" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_deal_attribution_check" CHECK ("core_deal_registration_attributions"."attribution" in ('sourced','influenced','none') and "core_deal_registration_attributions"."influence_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "core_deal_registration_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"challenger_partner_account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"tiebreak" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_deal_registration_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"matched_account_id" uuid,
	"evidence" jsonb NOT NULL,
	"status" text NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_deal_exclusion_kind_check" CHECK ("core_deal_registration_exclusions"."kind" in ('house_account','prior_deal','duplicate_entity','restricted_party','territory'))
);
--> statement-breakpoint
CREATE TABLE "core_invoice_end_client_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"end_client_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"stripe_invoice_line_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_invoice_allocation_amounts_check" CHECK ("core_invoice_end_client_allocations"."subtotal_minor" >= 0 and "core_invoice_end_client_allocations"."tax_minor" >= 0 and "core_invoice_end_client_allocations"."total_minor" = "core_invoice_end_client_allocations"."subtotal_minor" + "core_invoice_end_client_allocations"."tax_minor")
);
--> statement-breakpoint
CREATE TABLE "core_marketplace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_account_reference" text NOT NULL,
	"account_id" uuid,
	"order_id" uuid,
	"entitlement_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"currency" text,
	"gross_minor" bigint,
	"fee_minor" bigint,
	"tax_minor" bigint,
	"net_minor" bigint,
	"quantity" numeric(38, 18),
	"payload_hash" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_marketplace_provider_check" CHECK ("core_marketplace_events"."provider" in ('aws','azure','google')),
	CONSTRAINT "core_marketplace_payload_hash_check" CHECK ("core_marketplace_events"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_marketplace_financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace_event_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"provider_line_reference" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"service_period_starts_on" date,
	"service_period_ends_on" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_marketplace_entry_type_check" CHECK ("core_marketplace_financial_entries"."entry_type" in ('order','entitlement','metering','fee','invoice','settlement','refund','tax'))
);
--> statement-breakpoint
CREATE TABLE "core_marketplace_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"currency" text NOT NULL,
	"provider_gross_minor" bigint NOT NULL,
	"platform_gross_minor" bigint NOT NULL,
	"provider_fees_minor" bigint NOT NULL,
	"platform_fees_minor" bigint NOT NULL,
	"variance_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_order_commercial_profiles" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"merchant_of_record" text NOT NULL,
	"billing_shape" text NOT NULL,
	"provisioning_idempotency_key" text NOT NULL,
	"governing_agreement_version" integer NOT NULL,
	"deal_registration_id" uuid,
	"distributor_account_id" uuid,
	"co_term_parent_order_id" uuid,
	"invoice_grouping_key" text,
	"contractual_time_zone" text DEFAULT 'UTC' NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_order_commercial_profiles_provisioning_idempotency_key_unique" UNIQUE("provisioning_idempotency_key"),
	CONSTRAINT "core_order_mor_check" CHECK ("core_order_commercial_profiles"."merchant_of_record" in ('fil_one','partner','marketplace')),
	CONSTRAINT "core_order_billing_shape_check" CHECK ("core_order_commercial_profiles"."billing_shape" in ('direct','referral','resale','distributor','marketplace')),
	CONSTRAINT "core_order_agreement_version_check" CHECK ("core_order_commercial_profiles"."governing_agreement_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "core_order_line_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_order_line_snapshots_order_line_id_unique" UNIQUE("order_line_id"),
	CONSTRAINT "core_order_line_snapshot_hash_check" CHECK ("core_order_line_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_partner_hierarchy_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distributor_account_id" uuid NOT NULL,
	"reseller_account_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text NOT NULL,
	"settlement_responsibility" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_partner_hierarchy_self_check" CHECK ("core_partner_hierarchy_edges"."distributor_account_id" <> "core_partner_hierarchy_edges"."reseller_account_id"),
	CONSTRAINT "core_partner_hierarchy_dates_check" CHECK ("core_partner_hierarchy_edges"."effective_to" is null or "core_partner_hierarchy_edges"."effective_to" >= "core_partner_hierarchy_edges"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "core_partner_transfer_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"agreement_type" text NOT NULL,
	"tier" text NOT NULL,
	"transfer_price_minor" bigint NOT NULL,
	"floor_price_minor" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_transfer_tier_prices_check" CHECK ("core_partner_transfer_tiers"."transfer_price_minor" >= "core_partner_transfer_tiers"."floor_price_minor" and "core_partner_transfer_tiers"."floor_price_minor" >= 0),
	CONSTRAINT "core_transfer_tier_dates_check" CHECK ("core_partner_transfer_tiers"."effective_to" is null or "core_partner_transfer_tiers"."effective_to" >= "core_partner_transfer_tiers"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "core_price_book_activation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"resulting_status" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_price_activation_action_check" CHECK ("core_price_book_activation_events"."action" in ('activate','retire','schedule','cancel_schedule'))
);
--> statement-breakpoint
CREATE TABLE "core_pricing_exception_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"floor_total_minor" bigint NOT NULL,
	"quoted_total_minor" bigint NOT NULL,
	"modeled_margin_bps" integer NOT NULL,
	"impact_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_pricing_exception_status_check" CHECK ("core_pricing_exception_decisions"."status" in ('pending','approved','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "core_procurement_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"jurisdiction" text,
	"certificate_number" text,
	"document_id" uuid NOT NULL,
	"valid_from" date,
	"expires_on" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_procurement_cert_dates_check" CHECK ("core_procurement_certificates"."expires_on" is null or "core_procurement_certificates"."valid_from" is null or "core_procurement_certificates"."expires_on" >= "core_procurement_certificates"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "core_quote_commercial_profiles" (
	"quote_id" uuid PRIMARY KEY NOT NULL,
	"channel_shape" text NOT NULL,
	"merchant_of_record" text NOT NULL,
	"pricing_authority" text NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"distributor_account_id" uuid,
	"marketplace_provider" text,
	"transfer_total_minor" bigint,
	"partner_resale_total_minor" bigint,
	"white_label_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pricing_inputs" jsonb NOT NULL,
	"pricing_calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_quote_channel_shape_check" CHECK ("core_quote_commercial_profiles"."channel_shape" in ('direct','referral','resale','distributor','marketplace')),
	CONSTRAINT "core_quote_mor_check" CHECK ("core_quote_commercial_profiles"."merchant_of_record" in ('fil_one','partner','marketplace')),
	CONSTRAINT "core_quote_pricing_authority_check" CHECK ("core_quote_commercial_profiles"."pricing_authority" in ('fil_one','partner','marketplace'))
);
--> statement-breakpoint
CREATE TABLE "core_quote_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_quote_snapshot_hash_check" CHECK ("core_quote_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_three_way_tie_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"currency" text NOT NULL,
	"platform_revenue_minor" bigint NOT NULL,
	"stripe_revenue_minor" bigint NOT NULL,
	"qbo_revenue_minor" bigint NOT NULL,
	"stripe_variance_minor" bigint NOT NULL,
	"qbo_variance_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"variances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_three_way_tie_out_math_check" CHECK ("core_three_way_tie_outs"."stripe_variance_minor" = "core_three_way_tie_outs"."platform_revenue_minor" - "core_three_way_tie_outs"."stripe_revenue_minor" and "core_three_way_tie_outs"."qbo_variance_minor" = "core_three_way_tie_outs"."platform_revenue_minor" - "core_three_way_tie_outs"."qbo_revenue_minor")
);
--> statement-breakpoint
CREATE TABLE "core_usage_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"source_system" text NOT NULL,
	"source_quantity" numeric(38, 18) NOT NULL,
	"ledger_quantity" numeric(38, 18) NOT NULL,
	"variance_quantity" numeric(38, 18) NOT NULL,
	"status" text NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_usage_reconciliation_period_check" CHECK ("core_usage_reconciliations"."period_ends_at" > "core_usage_reconciliations"."period_starts_at")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_agreement_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"template_id" uuid,
	"customer_paper_document_id" uuid,
	"paper" text NOT NULL,
	"execution_mode" text NOT NULL,
	"negotiation_status" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"key_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_agreement_draft_paper_check" CHECK ("lifecycle_agreement_drafts"."paper" in ('ours','theirs')),
	CONSTRAINT "lifecycle_agreement_draft_mode_check" CHECK ("lifecycle_agreement_drafts"."execution_mode" in ('click_through','counter_signed')),
	CONSTRAINT "lifecycle_agreement_draft_status_check" CHECK ("lifecycle_agreement_drafts"."status" in ('draft','executed','void')),
	CONSTRAINT "lifecycle_agreement_draft_negotiation_check" CHECK ("lifecycle_agreement_drafts"."negotiation_status" in ('standard','uploaded','redlining','counsel_review','agreed','rejected')),
	CONSTRAINT "lifecycle_agreement_draft_source_check" CHECK (("lifecycle_agreement_drafts"."paper" = 'ours' and "lifecycle_agreement_drafts"."template_id" is not null and "lifecycle_agreement_drafts"."customer_paper_document_id" is null) or ("lifecycle_agreement_drafts"."paper" = 'theirs' and "lifecycle_agreement_drafts"."template_id" is null and "lifecycle_agreement_drafts"."customer_paper_document_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_agreement_template_texts" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"exact_text" text NOT NULL,
	"exact_text_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_agreement_template_texts_exact_text_hash_unique" UNIQUE("exact_text_hash"),
	CONSTRAINT "lifecycle_agreement_template_text_hash_check" CHECK ("lifecycle_agreement_template_texts"."exact_text_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_agreement_template_bytes_hash_check" CHECK (encode(extensions.digest(convert_to("lifecycle_agreement_template_texts"."exact_text", 'UTF8'), 'sha256'), 'hex') = "lifecycle_agreement_template_texts"."exact_text_hash")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_click_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exact_text_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_click_acceptances_agreement_id_unique" UNIQUE("agreement_id"),
	CONSTRAINT "lifecycle_click_acceptances_evidence_hash_unique" UNIQUE("evidence_hash"),
	CONSTRAINT "lifecycle_click_text_hash_check" CHECK ("lifecycle_click_acceptances"."exact_text_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_click_evidence_hash_check" CHECK ("lifecycle_click_acceptances"."evidence_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "lifecycle_domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text,
	"provider_event_id" text,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_domain_event_hash_check" CHECK ("lifecycle_domain_events"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_domain_event_sequence_check" CHECK ("lifecycle_domain_events"."sequence" > 0),
	CONSTRAINT "lifecycle_provider_identity_check" CHECK (("lifecycle_domain_events"."provider" is null and "lifecycle_domain_events"."provider_event_id" is null) or ("lifecycle_domain_events"."provider" is not null and "lifecycle_domain_events"."provider_event_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_feature_gate_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"approved" boolean NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"evidence_document_id" uuid NOT NULL,
	"authentication_evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_gate_separation_check" CHECK ("lifecycle_feature_gate_approvals"."requester_id" <> "lifecycle_feature_gate_approvals"."approver_id"),
	CONSTRAINT "lifecycle_gate_authentication_hash_check" CHECK ("lifecycle_feature_gate_approvals"."authentication_evidence_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "lifecycle_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"lock_token" uuid NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_idempotency_hash_check" CHECK ("lifecycle_idempotency_records"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_idempotency_completion_check" CHECK (("lifecycle_idempotency_records"."completed_at" is null and "lifecycle_idempotency_records"."response_status" is null and "lifecycle_idempotency_records"."response_body" is null) or ("lifecycle_idempotency_records"."completed_at" is not null and "lifecycle_idempotency_records"."response_status" is not null and "lifecycle_idempotency_records"."response_body" is not null))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_migration_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"legacy_account_id" text NOT NULL,
	"disposition" text NOT NULL,
	"account_id" uuid,
	"reason" text NOT NULL,
	"evidence_document_id" uuid NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_migration_disposition_check" CHECK ("lifecycle_migration_matches"."disposition" in ('create','attach','skip')),
	CONSTRAINT "lifecycle_migration_match_hash_check" CHECK ("lifecycle_migration_matches"."evidence_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_migration_attach_scope_check" CHECK (("lifecycle_migration_matches"."disposition" = 'attach' and "lifecycle_migration_matches"."account_id" is not null) or ("lifecycle_migration_matches"."disposition" <> 'attach' and "lifecycle_migration_matches"."account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_mode" text NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"source_kind" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"status" text NOT NULL,
	"batch_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_migration_mode_check" CHECK ("lifecycle_migration_runs"."execution_mode" in ('discovery','rehearsal','execute')),
	CONSTRAINT "lifecycle_migration_snapshot_hash_check" CHECK ("lifecycle_migration_runs"."source_snapshot_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_migration_source_kind_check" CHECK ("lifecycle_migration_runs"."source_kind" in ('fixture','real_snapshot')),
	CONSTRAINT "lifecycle_migration_status_check" CHECK ("lifecycle_migration_runs"."status" in ('discovery','accounts','orders','complete','failed')),
	CONSTRAINT "lifecycle_migration_batch_size_check" CHECK ("lifecycle_migration_runs"."batch_size" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_offboarding_plans" (
	"termination_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_offboarding_reason_check" CHECK ("lifecycle_offboarding_plans"."reason" in ('customer_request','non_renewal','partner_request','partner_default','material_breach'))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_partner_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verification_token_hash" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"brand_name" text NOT NULL,
	"logo_url" text,
	"primary_color" text NOT NULL,
	"communication_owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_partner_domain_token_hash_check" CHECK ("lifecycle_partner_domains"."verification_token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_partner_domain_color_check" CHECK ("lifecycle_partner_domains"."primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "lifecycle_partner_domain_owner_check" CHECK ("lifecycle_partner_domains"."communication_owner" in ('fil_one','partner'))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_pass_through_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"exact_text_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"accepted_ip" text NOT NULL,
	"ui_context" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_pass_through_acceptances_evidence_hash_unique" UNIQUE("evidence_hash"),
	CONSTRAINT "lifecycle_pass_through_hash_check" CHECK ("lifecycle_pass_through_acceptances"."exact_text_hash" ~ '^[a-f0-9]{64}$' and "lifecycle_pass_through_acceptances"."evidence_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "lifecycle_poc_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poc_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"evidence_hash" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_poc_evidence_kind_check" CHECK ("lifecycle_poc_evidence"."kind" in ('success_snapshot','quote_acceptance')),
	CONSTRAINT "lifecycle_poc_evidence_hash_check" CHECK ("lifecycle_poc_evidence"."evidence_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "lifecycle_provisioning_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid,
	"poc_id" uuid,
	"organization_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"state" text NOT NULL,
	"attempt" jsonb NOT NULL,
	"provider_operation_id" text,
	"last_provider_occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_provisioning_attempts_command_id_unique" UNIQUE("command_id"),
	CONSTRAINT "lifecycle_provisioning_state_check" CHECK ("lifecycle_provisioning_attempts"."state" in ('pending','in_flight','retry_scheduled','dead_letter','confirmed')),
	CONSTRAINT "lifecycle_provisioning_operation_check" CHECK ("lifecycle_provisioning_attempts"."operation" in ('provision','upgrade_poc','sandbox','teardown')),
	CONSTRAINT "lifecycle_provisioning_scope_check" CHECK (("lifecycle_provisioning_attempts"."poc_id" is not null and "lifecycle_provisioning_attempts"."order_id" is null and "lifecycle_provisioning_attempts"."operation" = 'sandbox') or ("lifecycle_provisioning_attempts"."order_id" is not null and "lifecycle_provisioning_attempts"."poc_id" is null and "lifecycle_provisioning_attempts"."operation" <> 'sandbox'))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_renewal_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"evidence_document_id" uuid,
	"payload" jsonb NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_renewal_actions_evidence_hash_unique" UNIQUE("evidence_hash"),
	CONSTRAINT "lifecycle_renewal_action_check" CHECK ("lifecycle_renewal_actions"."action" in ('renew','change_term','request_change','decline')),
	CONSTRAINT "lifecycle_renewal_evidence_hash_check" CHECK ("lifecycle_renewal_actions"."evidence_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lifecycle_renewal_decline_evidence_check" CHECK ("lifecycle_renewal_actions"."action" <> 'decline' or "lifecycle_renewal_actions"."evidence_document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_signature_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_draft_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_envelope_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_email" text NOT NULL,
	"signing_mode" text NOT NULL,
	"return_url" text NOT NULL,
	"state" text NOT NULL,
	"provider_sequence" integer DEFAULT 0 NOT NULL,
	"provider_event_ids" text[] DEFAULT '{}' NOT NULL,
	"signed_pdf_document_id" uuid,
	"completion_certificate_document_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lifecycle_signature_envelopes_provider_envelope_id_unique" UNIQUE("provider_envelope_id"),
	CONSTRAINT "lifecycle_envelope_mode_check" CHECK ("lifecycle_signature_envelopes"."signing_mode" in ('redirect','embedded')),
	CONSTRAINT "lifecycle_envelope_state_check" CHECK ("lifecycle_signature_envelopes"."state" in ('created','sent','viewed','completed','declined','expired','voided')),
	CONSTRAINT "lifecycle_envelope_sequence_check" CHECK ("lifecycle_signature_envelopes"."provider_sequence" >= 0),
	CONSTRAINT "lifecycle_envelope_completion_check" CHECK ("lifecycle_signature_envelopes"."state" <> 'completed' or ("lifecycle_signature_envelopes"."signed_pdf_document_id" is not null and "lifecycle_signature_envelopes"."completion_certificate_document_id" is not null and "lifecycle_signature_envelopes"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "system_external_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate_key" text NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"input_required" text NOT NULL,
	"affected_feature" text NOT NULL,
	"severity" text NOT NULL,
	"configured_status" text DEFAULT 'blocked' NOT NULL,
	"simulator_state" text DEFAULT 'unavailable' NOT NULL,
	"simulator_details" text NOT NULL,
	"last_activation_test_status" text DEFAULT 'never' NOT NULL,
	"last_activation_test_at" timestamp with time zone,
	"last_activation_tested_by" text,
	"activation_evidence_reference" text,
	"review_on" date,
	"status_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "system_external_gates_gate_key_unique" UNIQUE("gate_key"),
	CONSTRAINT "system_external_gates_key_check" CHECK ("system_external_gates"."gate_key" ~ '^EXT-[A-Z]+-[0-9]{2}$'),
	CONSTRAINT "system_external_gates_status_check" CHECK ("system_external_gates"."configured_status" in ('blocked','review','pending','active','not_required')),
	CONSTRAINT "system_external_gates_simulator_check" CHECK ("system_external_gates"."simulator_state" in ('ready','degraded','unavailable')),
	CONSTRAINT "system_external_gates_test_status_check" CHECK ("system_external_gates"."last_activation_test_status" in ('never','passed','failed'))
);
--> statement-breakpoint
CREATE TABLE "system_provider_projection_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"aggregate_key" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_provider_resource_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_resource_type" text NOT NULL,
	"provider_resource_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"binding" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_provider_binding_names_check" CHECK (length(trim("system_provider_resource_bindings"."provider")) > 0 and length(trim("system_provider_resource_bindings"."provider_resource_type")) > 0 and length(trim("system_provider_resource_bindings"."provider_resource_id")) > 0 and length(trim("system_provider_resource_bindings"."aggregate_type")) > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_sourcing_check";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "stripe_invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "commission_holdback_bps" integer;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD COLUMN "source_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD COLUMN "source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD COLUMN "holdback_bps" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "accounting_posting_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_last_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_last_event_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_last_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_last_event_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "lock_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "core_commercial_artifact_requests" ADD CONSTRAINT "core_commercial_artifact_requests_commercial_account_id_accounts_id_fk" FOREIGN KEY ("commercial_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commercial_artifact_requests" ADD CONSTRAINT "core_commercial_artifact_requests_audience_account_id_accounts_id_fk" FOREIGN KEY ("audience_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commercial_artifact_requests" ADD CONSTRAINT "core_commercial_artifact_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commercial_artifact_requests" ADD CONSTRAINT "core_commercial_artifact_requests_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_account_commercial_profiles" ADD CONSTRAINT "core_account_commercial_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_account_commercial_profiles" ADD CONSTRAINT "core_account_commercial_profiles_collections_owner_id_commerce_users_id_fk" FOREIGN KEY ("collections_owner_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_account_contacts" ADD CONSTRAINT "core_account_contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_account_relationship_roles" ADD CONSTRAINT "core_account_relationship_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_account_tax_identifiers" ADD CONSTRAINT "core_account_tax_identifiers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_accounting_export_entries" ADD CONSTRAINT "core_accounting_export_entries_export_id_core_accounting_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."core_accounting_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_amendment_financial_terms" ADD CONSTRAINT "core_amendment_financial_terms_amendment_id_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_amendment_line_supersessions" ADD CONSTRAINT "core_amendment_line_supersessions_amendment_id_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_amendment_line_supersessions" ADD CONSTRAINT "core_amendment_line_supersessions_superseded_order_line_id_order_lines_id_fk" FOREIGN KEY ("superseded_order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_billing_policies" ADD CONSTRAINT "core_billing_policies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_collection_actions" ADD CONSTRAINT "core_collection_actions_collection_case_id_core_collection_cases_id_fk" FOREIGN KEY ("collection_case_id") REFERENCES "public"."core_collection_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_collection_actions" ADD CONSTRAINT "core_collection_actions_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_collection_cases" ADD CONSTRAINT "core_collection_cases_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_collection_cases" ADD CONSTRAINT "core_collection_cases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_collection_cases" ADD CONSTRAINT "core_collection_cases_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_settlement_exports" ADD CONSTRAINT "core_commission_settlement_exports_statement_id_core_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."core_commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_settlement_exports" ADD CONSTRAINT "core_commission_settlement_exports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_statement_lines" ADD CONSTRAINT "core_commission_statement_lines_statement_id_core_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."core_commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_statement_lines" ADD CONSTRAINT "core_commission_statement_lines_accrual_id_commission_accruals_id_fk" FOREIGN KEY ("accrual_id") REFERENCES "public"."commission_accruals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_statements" ADD CONSTRAINT "core_commission_statements_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commission_statements" ADD CONSTRAINT "core_commission_statements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_ledger_corrections" ADD CONSTRAINT "core_commitment_ledger_corrections_ledger_id_commitment_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."commitment_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_ledger_corrections" ADD CONSTRAINT "core_commitment_ledger_corrections_period_id_core_commitment_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."core_commitment_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_ledger_corrections" ADD CONSTRAINT "core_commitment_ledger_corrections_reverses_entry_id_commitment_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."commitment_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_ledger_corrections" ADD CONSTRAINT "core_commitment_ledger_corrections_recorded_by_commerce_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_periods" ADD CONSTRAINT "core_commitment_periods_ledger_id_commitment_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."commitment_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_attributions" ADD CONSTRAINT "core_deal_registration_attributions_registration_id_deal_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."deal_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_attributions" ADD CONSTRAINT "core_deal_registration_attributions_decided_by_commerce_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_disputes" ADD CONSTRAINT "core_deal_registration_disputes_registration_id_deal_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."deal_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_disputes" ADD CONSTRAINT "core_deal_registration_disputes_challenger_partner_account_id_accounts_id_fk" FOREIGN KEY ("challenger_partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_disputes" ADD CONSTRAINT "core_deal_registration_disputes_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_disputes" ADD CONSTRAINT "core_deal_registration_disputes_decided_by_commerce_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_exclusions" ADD CONSTRAINT "core_deal_registration_exclusions_registration_id_deal_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."deal_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_exclusions" ADD CONSTRAINT "core_deal_registration_exclusions_matched_account_id_accounts_id_fk" FOREIGN KEY ("matched_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_deal_registration_exclusions" ADD CONSTRAINT "core_deal_registration_exclusions_resolved_by_commerce_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_end_client_allocations" ADD CONSTRAINT "core_invoice_end_client_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_end_client_allocations" ADD CONSTRAINT "core_invoice_end_client_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_end_client_allocations" ADD CONSTRAINT "core_invoice_end_client_allocations_end_client_account_id_accounts_id_fk" FOREIGN KEY ("end_client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_marketplace_events" ADD CONSTRAINT "core_marketplace_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_marketplace_events" ADD CONSTRAINT "core_marketplace_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_marketplace_events" ADD CONSTRAINT "core_marketplace_events_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_marketplace_financial_entries" ADD CONSTRAINT "core_marketplace_financial_entries_marketplace_event_id_core_marketplace_events_id_fk" FOREIGN KEY ("marketplace_event_id") REFERENCES "public"."core_marketplace_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_deal_registration_id_deal_registrations_id_fk" FOREIGN KEY ("deal_registration_id") REFERENCES "public"."deal_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_distributor_account_id_accounts_id_fk" FOREIGN KEY ("distributor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_co_term_parent_order_id_orders_id_fk" FOREIGN KEY ("co_term_parent_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_line_snapshots" ADD CONSTRAINT "core_order_line_snapshots_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_partner_hierarchy_edges" ADD CONSTRAINT "core_partner_hierarchy_edges_distributor_account_id_accounts_id_fk" FOREIGN KEY ("distributor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_partner_hierarchy_edges" ADD CONSTRAINT "core_partner_hierarchy_edges_reseller_account_id_accounts_id_fk" FOREIGN KEY ("reseller_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_partner_transfer_tiers" ADD CONSTRAINT "core_partner_transfer_tiers_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_activation_events" ADD CONSTRAINT "core_price_book_activation_events_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_activation_events" ADD CONSTRAINT "core_price_book_activation_events_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_pricing_exception_decisions" ADD CONSTRAINT "core_pricing_exception_decisions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_pricing_exception_decisions" ADD CONSTRAINT "core_pricing_exception_decisions_assigned_to_commerce_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_pricing_exception_decisions" ADD CONSTRAINT "core_pricing_exception_decisions_decided_by_commerce_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_procurement_certificates" ADD CONSTRAINT "core_procurement_certificates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_procurement_certificates" ADD CONSTRAINT "core_procurement_certificates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_quote_commercial_profiles" ADD CONSTRAINT "core_quote_commercial_profiles_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_quote_commercial_profiles" ADD CONSTRAINT "core_quote_commercial_profiles_billing_account_id_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_quote_commercial_profiles" ADD CONSTRAINT "core_quote_commercial_profiles_distributor_account_id_accounts_id_fk" FOREIGN KEY ("distributor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_quote_snapshots" ADD CONSTRAINT "core_quote_snapshots_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_quote_snapshots" ADD CONSTRAINT "core_quote_snapshots_created_by_commerce_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_three_way_tie_outs" ADD CONSTRAINT "core_three_way_tie_outs_reviewed_by_commerce_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_usage_reconciliations" ADD CONSTRAINT "core_usage_reconciliations_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_drafts" ADD CONSTRAINT "lifecycle_agreement_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_drafts" ADD CONSTRAINT "lifecycle_agreement_drafts_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_drafts" ADD CONSTRAINT "lifecycle_agreement_drafts_customer_paper_document_id_documents_id_fk" FOREIGN KEY ("customer_paper_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_drafts" ADD CONSTRAINT "lifecycle_agreement_drafts_created_by_commerce_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_template_texts" ADD CONSTRAINT "lifecycle_agreement_template_texts_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_click_acceptances" ADD CONSTRAINT "lifecycle_click_acceptances_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_click_acceptances" ADD CONSTRAINT "lifecycle_click_acceptances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_click_acceptances" ADD CONSTRAINT "lifecycle_click_acceptances_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_click_acceptances" ADD CONSTRAINT "lifecycle_click_acceptances_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_feature_gate_approvals" ADD CONSTRAINT "lifecycle_feature_gate_approvals_requester_id_commerce_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_feature_gate_approvals" ADD CONSTRAINT "lifecycle_feature_gate_approvals_approver_id_commerce_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_feature_gate_approvals" ADD CONSTRAINT "lifecycle_feature_gate_approvals_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_idempotency_records" ADD CONSTRAINT "lifecycle_idempotency_records_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_migration_matches" ADD CONSTRAINT "lifecycle_migration_matches_run_id_lifecycle_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."lifecycle_migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_migration_matches" ADD CONSTRAINT "lifecycle_migration_matches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_migration_matches" ADD CONSTRAINT "lifecycle_migration_matches_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_migration_matches" ADD CONSTRAINT "lifecycle_migration_matches_decided_by_commerce_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_migration_runs" ADD CONSTRAINT "lifecycle_migration_runs_requester_id_commerce_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_offboarding_plans" ADD CONSTRAINT "lifecycle_offboarding_plans_termination_id_terminations_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."terminations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_offboarding_plans" ADD CONSTRAINT "lifecycle_offboarding_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_offboarding_plans" ADD CONSTRAINT "lifecycle_offboarding_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_offboarding_plans" ADD CONSTRAINT "lifecycle_offboarding_plans_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_partner_domains" ADD CONSTRAINT "lifecycle_partner_domains_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_pass_through_acceptances" ADD CONSTRAINT "lifecycle_pass_through_acceptances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_pass_through_acceptances" ADD CONSTRAINT "lifecycle_pass_through_acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_pass_through_acceptances" ADD CONSTRAINT "lifecycle_pass_through_acceptances_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_pass_through_acceptances" ADD CONSTRAINT "lifecycle_pass_through_acceptances_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_poc_evidence" ADD CONSTRAINT "lifecycle_poc_evidence_poc_id_pocs_id_fk" FOREIGN KEY ("poc_id") REFERENCES "public"."pocs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_provisioning_attempts" ADD CONSTRAINT "lifecycle_provisioning_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_provisioning_attempts" ADD CONSTRAINT "lifecycle_provisioning_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_provisioning_attempts" ADD CONSTRAINT "lifecycle_provisioning_attempts_poc_id_pocs_id_fk" FOREIGN KEY ("poc_id") REFERENCES "public"."pocs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_provisioning_attempts" ADD CONSTRAINT "lifecycle_provisioning_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_renewal_actions" ADD CONSTRAINT "lifecycle_renewal_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_renewal_actions" ADD CONSTRAINT "lifecycle_renewal_actions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_renewal_actions" ADD CONSTRAINT "lifecycle_renewal_actions_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_renewal_actions" ADD CONSTRAINT "lifecycle_renewal_actions_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ADD CONSTRAINT "lifecycle_signature_envelopes_agreement_draft_id_lifecycle_agreement_drafts_id_fk" FOREIGN KEY ("agreement_draft_id") REFERENCES "public"."lifecycle_agreement_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ADD CONSTRAINT "lifecycle_signature_envelopes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ADD CONSTRAINT "lifecycle_signature_envelopes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ADD CONSTRAINT "lifecycle_signature_envelopes_signed_pdf_document_id_documents_id_fk" FOREIGN KEY ("signed_pdf_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ADD CONSTRAINT "lifecycle_signature_envelopes_completion_certificate_document_id_documents_id_fk" FOREIGN KEY ("completion_certificate_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "core_commercial_artifact_source_unique" ON "core_commercial_artifact_requests" USING btree ("subject_type","subject_id","document_kind","source_hash");--> statement-breakpoint
CREATE INDEX "core_commercial_artifact_dispatch_idx" ON "core_commercial_artifact_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "core_commercial_artifact_document_idx" ON "core_commercial_artifact_requests" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_account_entity_fingerprint_unique" ON "core_account_commercial_profiles" USING btree ("legal_entity_fingerprint");--> statement-breakpoint
CREATE INDEX "core_account_credit_queue_idx" ON "core_account_commercial_profiles" USING btree ("credit_status","new_service_blocked");--> statement-breakpoint
CREATE INDEX "core_account_contacts_account_idx" ON "core_account_contacts" USING btree ("account_id","kind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "core_account_contacts_primary_unique" ON "core_account_contacts" USING btree ("account_id","kind") WHERE "core_account_contacts"."is_primary" and "core_account_contacts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "core_tax_identifier_entity_unique" ON "core_account_tax_identifiers" USING btree ("jurisdiction","type","normalized_value");--> statement-breakpoint
CREATE INDEX "core_tax_identifier_account_idx" ON "core_account_tax_identifiers" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_accounting_export_source_unique" ON "core_accounting_export_entries" USING btree ("export_id","source_type","source_id","account_code");--> statement-breakpoint
CREATE INDEX "core_accounting_export_queue_idx" ON "core_accounting_exports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_amendment_line_supersession_unique" ON "core_amendment_line_supersessions" USING btree ("amendment_id","superseded_order_line_id");--> statement-breakpoint
CREATE INDEX "core_collection_action_timeline_idx" ON "core_collection_actions" USING btree ("collection_case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "core_collection_queue_idx" ON "core_collection_cases" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "core_commission_settlement_queue_idx" ON "core_commission_settlement_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "core_commission_statement_line_idx" ON "core_commission_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_commission_statement_period_unique" ON "core_commission_statements" USING btree ("partner_account_id","period_starts_on","period_ends_on","currency");--> statement-breakpoint
CREATE INDEX "core_commission_statement_queue_idx" ON "core_commission_statements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "core_ledger_correction_source_unique" ON "core_commitment_ledger_corrections" USING btree ("ledger_id","source_reference");--> statement-breakpoint
CREATE INDEX "core_ledger_correction_period_idx" ON "core_commitment_ledger_corrections" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_commitment_period_sequence_unique" ON "core_commitment_periods" USING btree ("ledger_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "core_commitment_period_boundary_unique" ON "core_commitment_periods" USING btree ("ledger_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "core_commitment_period_open_idx" ON "core_commitment_periods" USING btree ("status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_deal_dispute_open_unique" ON "core_deal_registration_disputes" USING btree ("registration_id") WHERE "core_deal_registration_disputes"."status" in ('open','under_review');--> statement-breakpoint
CREATE INDEX "core_deal_dispute_queue_idx" ON "core_deal_registration_disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "core_deal_exclusion_queue_idx" ON "core_deal_registration_exclusions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_invoice_end_client_allocation_unique" ON "core_invoice_end_client_allocations" USING btree ("invoice_id","order_id","end_client_account_id");--> statement-breakpoint
CREATE INDEX "core_invoice_end_client_idx" ON "core_invoice_end_client_allocations" USING btree ("end_client_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_marketplace_event_dedup_unique" ON "core_marketplace_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "core_marketplace_event_queue_idx" ON "core_marketplace_events" USING btree ("provider","processing_status","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_marketplace_financial_line_unique" ON "core_marketplace_financial_entries" USING btree ("marketplace_event_id","provider_line_reference","entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "core_marketplace_reconciliation_period_unique" ON "core_marketplace_reconciliations" USING btree ("provider","period_starts_on","period_ends_on","currency");--> statement-breakpoint
CREATE INDEX "core_marketplace_reconciliation_queue_idx" ON "core_marketplace_reconciliations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "core_order_mor_idx" ON "core_order_commercial_profiles" USING btree ("merchant_of_record","billing_shape");--> statement-breakpoint
CREATE INDEX "core_order_registration_idx" ON "core_order_commercial_profiles" USING btree ("deal_registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_order_line_snapshot_hash_unique" ON "core_order_line_snapshots" USING btree ("snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "core_partner_hierarchy_active_reseller_unique" ON "core_partner_hierarchy_edges" USING btree ("reseller_account_id") WHERE "core_partner_hierarchy_edges"."status" = 'active';--> statement-breakpoint
CREATE INDEX "core_partner_hierarchy_distributor_idx" ON "core_partner_hierarchy_edges" USING btree ("distributor_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "core_transfer_tier_unique" ON "core_partner_transfer_tiers" USING btree ("rate_card_id","agreement_type","tier","effective_from");--> statement-breakpoint
CREATE INDEX "core_price_activation_timeline_idx" ON "core_price_book_activation_events" USING btree ("price_book_id","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_pricing_exception_open_unique" ON "core_pricing_exception_decisions" USING btree ("quote_id") WHERE "core_pricing_exception_decisions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "core_pricing_exception_queue_idx" ON "core_pricing_exception_decisions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "core_procurement_cert_expiry_idx" ON "core_procurement_certificates" USING btree ("account_id","status","expires_on");--> statement-breakpoint
CREATE INDEX "core_quote_channel_idx" ON "core_quote_commercial_profiles" USING btree ("channel_shape","merchant_of_record");--> statement-breakpoint
CREATE UNIQUE INDEX "core_quote_snapshot_quote_unique" ON "core_quote_snapshots" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_quote_snapshot_hash_unique" ON "core_quote_snapshots" USING btree ("snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "core_three_way_tie_out_period_unique" ON "core_three_way_tie_outs" USING btree ("period_starts_on","period_ends_on","currency");--> statement-breakpoint
CREATE INDEX "core_three_way_tie_out_queue_idx" ON "core_three_way_tie_outs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "core_usage_reconciliation_unique" ON "core_usage_reconciliations" USING btree ("entitlement_id","period_starts_at","period_ends_at","source_system");--> statement-breakpoint
CREATE INDEX "core_usage_reconciliation_queue_idx" ON "core_usage_reconciliations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lifecycle_agreement_draft_account_idx" ON "lifecycle_agreement_drafts" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_provider_event_unique" ON "lifecycle_domain_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_aggregate_sequence_unique" ON "lifecycle_domain_events" USING btree ("aggregate_type","aggregate_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_gate_approver_unique" ON "lifecycle_feature_gate_approvals" USING btree ("gate","requester_id","approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_idempotency_owner_key_unique" ON "lifecycle_idempotency_records" USING btree ("owner_user_id","scope","key");--> statement-breakpoint
CREATE INDEX "lifecycle_idempotency_expiry_idx" ON "lifecycle_idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_migration_match_unique" ON "lifecycle_migration_matches" USING btree ("run_id","legacy_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_migration_snapshot_mode_unique" ON "lifecycle_migration_runs" USING btree ("source_snapshot_hash","execution_mode");--> statement-breakpoint
CREATE INDEX "lifecycle_migration_status_idx" ON "lifecycle_migration_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "lifecycle_offboarding_account_idx" ON "lifecycle_offboarding_plans" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_partner_domain_unique" ON "lifecycle_partner_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "lifecycle_partner_domain_account_idx" ON "lifecycle_partner_domains" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_pass_through_version_unique" ON "lifecycle_pass_through_acceptances" USING btree ("organization_id","template_id","template_version","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_poc_evidence_source_unique" ON "lifecycle_poc_evidence" USING btree ("poc_id","kind","source_id");--> statement-breakpoint
CREATE INDEX "lifecycle_provisioning_state_idx" ON "lifecycle_provisioning_attempts" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "lifecycle_renewal_action_order_idx" ON "lifecycle_renewal_actions" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "lifecycle_envelope_draft_idx" ON "lifecycle_signature_envelopes" USING btree ("agreement_draft_id");--> statement-breakpoint
CREATE INDEX "system_external_gates_status_idx" ON "system_external_gates" USING btree ("configured_status","review_on");--> statement-breakpoint
CREATE UNIQUE INDEX "system_provider_projection_checkpoint_unique" ON "system_provider_projection_checkpoints" USING btree ("provider","aggregate_key");--> statement-breakpoint
CREATE INDEX "system_provider_projection_checkpoint_time_idx" ON "system_provider_projection_checkpoints" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_provider_resource_binding_unique" ON "system_provider_resource_bindings" USING btree ("provider","provider_resource_type","provider_resource_id");--> statement-breakpoint
CREATE INDEX "system_provider_aggregate_binding_idx" ON "system_provider_resource_bindings" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_adjustment_source_id_commission_accruals_id_fk" FOREIGN KEY ("adjustment_source_id") REFERENCES "public"."commission_accruals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_accruals_source_unique" ON "commission_accruals" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_order_line_unique" ON "entitlements" USING btree ("order_line_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accounting_posting_id_unique" UNIQUE("accounting_posting_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_commission_policy_check" CHECK (("accounts"."commission_rate_bps" is null) = ("accounts"."commission_holdback_bps" is null) and ("accounts"."commission_rate_bps" is null or ("accounts"."commission_rate_bps" between 0 and 10000 and "accounts"."commission_holdback_bps" between 0 and 10000)));--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_source_type_check" CHECK ("commission_accruals"."source_type" in ('payment','credit_note','refund','dispute'));--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_policy_check" CHECK ("commission_accruals"."rate_bps" between 0 and 10000 and "commission_accruals"."holdback_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_sign_check" CHECK (("commission_accruals"."source_type" = 'payment' and "commission_accruals"."adjustment_source_id" is null and "commission_accruals"."net_collected_revenue_minor" >= 0 and "commission_accruals"."amount_minor" >= 0 and "commission_accruals"."holdback_minor" >= 0) or ("commission_accruals"."source_type" <> 'payment' and "commission_accruals"."adjustment_source_id" is not null and "commission_accruals"."net_collected_revenue_minor" <= 0 and "commission_accruals"."amount_minor" <= 0 and "commission_accruals"."holdback_minor" <= 0));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_provider_binding_check" CHECK (("invoices"."status" = 'draft' and "invoices"."stripe_invoice_id" is null) or ("invoices"."status" <> 'draft' and "invoices"."stripe_invoice_id" is not null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stripe_watermark_check" CHECK (("invoices"."stripe_last_occurred_at" is null) = ("invoices"."stripe_last_event_id" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sourcing_check" CHECK ("orders"."sourcing" in ('direct','referral','resale','distributor','marketplace'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_watermark_check" CHECK (("payments"."stripe_last_occurred_at" is null) = ("payments"."stripe_last_event_id" is null));