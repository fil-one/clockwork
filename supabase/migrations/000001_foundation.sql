-- Foundation migration range is reserved as 000001-000099. Lane migrations start at 000100.
-- This SQL file is canonical; Drizzle metadata is an introspection aid, never the migration source.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

-- Application connections never run as postgres. Password/login provisioning is
-- deployment-owned; migrations create the stable, least-privilege role names.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'clockwork_runtime') then
    create role clockwork_runtime nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'clockwork_service') then
    create role clockwork_service nologin noinherit nobypassrls;
  end if;
end $$;
grant clockwork_runtime, clockwork_service to postgres;

create schema if not exists private;
revoke all on schema private from public;
create table private.authorization_secrets (
  id text primary key,
  secret text not null check (length(secret) >= 32),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);
revoke all on private.authorization_secrets from public, clockwork_runtime, clockwork_service;

CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"relationship_roles" text[] NOT NULL,
	"registered_address" jsonb NOT NULL,
	"tax_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"billing_contact" jsonb NOT NULL,
	"ap_contact" jsonb NOT NULL,
	"invoice_delivery_email" text NOT NULL,
	"domain" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"screening_status" text DEFAULT 'pending' NOT NULL,
	"stripe_customer_id" text,
	"crm_record_id" text,
	"parent_partner_id" uuid,
	"partner_agreement_type" text,
	"partner_discount_tier" text,
	"commission_rate_bps" integer,
	"aggregate_credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" in ('USD','EUR','GBP')),
	CONSTRAINT "accounts_roles_nonempty_check" CHECK (cardinality("accounts"."relationship_roles") > 0),
	CONSTRAINT "accounts_credit_nonnegative_check" CHECK ("accounts"."aggregate_credit_limit_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agreement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"semantic_version" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"effective_on" date NOT NULL,
	"canonical_document_id" uuid NOT NULL,
	"text_hash" text NOT NULL,
	"execution_mode" text NOT NULL,
	"approval_status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"template_id" uuid,
	"paper" text NOT NULL,
	"execution_mode" text NOT NULL,
	"executed_document_id" uuid NOT NULL,
	"evidence_document_id" uuid,
	"envelope_id" text,
	"negotiation_status" text NOT NULL,
	"effective_on" date NOT NULL,
	"term_months" integer,
	"renewal_type" text NOT NULL,
	"notice_days" integer NOT NULL,
	"status" text NOT NULL,
	"superseded_by_id" uuid,
	"signer_user_id" uuid NOT NULL,
	"authority_title" text NOT NULL,
	"authority_attested" boolean NOT NULL,
	"accepted_ip" text NOT NULL,
	"accepted_user_agent" text NOT NULL,
	"text_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agreements_authority_check" CHECK ("agreements"."authority_attested" = true)
);
--> statement-breakpoint
CREATE TABLE "amendment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amendment_id" uuid NOT NULL,
	"order_line_id" uuid,
	"sku" text NOT NULL,
	"quantity_delta" numeric(38, 18) NOT NULL,
	"price_delta_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"kind" text NOT NULL,
	"proration_method" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approvals_two_person_check" CHECK ("approvals"."approved_by" is null or "approvals"."approved_by" <> "approvals"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"actor" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"is_internal_staff" boolean DEFAULT false NOT NULL,
	"mfa_enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commerce_users_workos_user_id_unique" UNIQUE("workos_user_id"),
	CONSTRAINT "commerce_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "commission_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_account_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"adjustment_source_id" uuid,
	"rate_bps" integer NOT NULL,
	"currency" text NOT NULL,
	"net_collected_revenue_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"holdback_minor" bigint NOT NULL,
	"period" text NOT NULL,
	"statement_document_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitment_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"usage_event_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"overage_quantity" numeric(38, 18) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commitment_entries_usage_event_id_unique" UNIQUE("usage_event_id")
);
--> statement-breakpoint
CREATE TABLE "commitment_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"commit_type" text NOT NULL,
	"committed_quantity" numeric(38, 18) NOT NULL,
	"consumed_quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"overage_quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commitment_quantities_check" CHECK ("commitment_ledgers"."committed_quantity" >= 0 and "commitment_ledgers"."consumed_quantity" >= 0 and "commitment_ledgers"."overage_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_credit_note_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "credit_notes_stripe_credit_note_id_unique" UNIQUE("stripe_credit_note_id")
);
--> statement-breakpoint
CREATE TABLE "deal_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_account_id" uuid NOT NULL,
	"end_client_account_id" uuid NOT NULL,
	"workload" text NOT NULL,
	"expected_volume" numeric(38, 18) NOT NULL,
	"status" text NOT NULL,
	"protection_starts_at" timestamp with time zone NOT NULL,
	"protection_ends_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"converted_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"termination_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"method" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"locked_exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deletion_certificates_termination_id_unique" UNIQUE("termination_id")
);
--> statement-breakpoint
CREATE TABLE "dispute_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"evidence_due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dispute_cases_stripe_dispute_id_unique" UNIQUE("stripe_dispute_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"object_lock_mode" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"storage_version_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "documents_hash_check" CHECK ("documents"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "documents_bytes_nonnegative_check" CHECK ("documents"."byte_length" >= 0),
	CONSTRAINT "documents_lock_mode_check" CHECK ("documents"."object_lock_mode" in ('COMPLIANCE','GOVERNANCE'))
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"committed_quantity" numeric(38, 18) NOT NULL,
	"region" text NOT NULL,
	"activated_at" timestamp with time zone,
	"maximum_retention_at" timestamp with time zone,
	"provisioned_resource_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exception_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"backup_user_id" uuid,
	"target_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" jsonb,
	"lock_token" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_user_id" uuid NOT NULL,
	"target_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"served_on" date NOT NULL,
	"evidence_document_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"po_number" text,
	"status" text NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "key_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"sla_credit_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"liability_cap_minor" bigint,
	"liability_cap_currency" text,
	"breach_notice_hours" integer NOT NULL,
	"renewal_price_protection_bps" integer,
	"audit_rights" text NOT NULL,
	"retention_liability_rule" text NOT NULL,
	"custom_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "key_terms_agreement_id_unique" UNIQUE("agreement_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workos_membership_id" text,
	"role" text NOT NULL,
	"approval_limit_minor" bigint,
	"approval_limit_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"former_partner_account_id" uuid NOT NULL,
	"source_order_id" uuid NOT NULL,
	"new_agreement_id" uuid NOT NULL,
	"new_order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"continuity_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"quote_line_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"overage_rate_minor" bigint NOT NULL,
	"superseded_by_amendment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "order_lines_quote_line_id_unique" UNIQUE("quote_line_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"invoicing_account_id" uuid NOT NULL,
	"partner_account_id" uuid,
	"sourcing" text NOT NULL,
	"po_number" text,
	"po_document_id" uuid,
	"signer_user_id" uuid NOT NULL,
	"authority_title" text NOT NULL,
	"authority_attested" boolean NOT NULL,
	"status" text NOT NULL,
	"service_starts_on" date NOT NULL,
	"service_ends_on" date,
	"notice_on" date,
	"order_form_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"immutable_at" timestamp with time zone,
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "orders_term_check" CHECK ("orders"."service_ends_on" is null or "orders"."service_ends_on" >= "orders"."service_starts_on"),
	CONSTRAINT "orders_authority_check" CHECK ("orders"."authority_attested" = true)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"isolated" boolean DEFAULT false NOT NULL,
	"workos_organization_id" text,
	"external_provisioning_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_external_provisioning_id_unique" UNIQUE("external_provisioning_id"),
	CONSTRAINT "organizations_workos_organization_id_unique" UNIQUE("workos_organization_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_messages_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "pocs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_account_id" uuid,
	"workload" text NOT NULL,
	"permitted_data_class" text NOT NULL,
	"success_tests" jsonb NOT NULL,
	"commercial_range" jsonb NOT NULL,
	"capacity_cap" numeric(38, 18) NOT NULL,
	"egress_cap" numeric(38, 18) NOT NULL,
	"duration_days" integer NOT NULL,
	"named_keys" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"support_owner_id" uuid NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"midpoint_at" timestamp with time zone NOT NULL,
	"final_report_at" timestamp with time zone NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"engineering_minutes" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"converted_quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"po_required" boolean DEFAULT false NOT NULL,
	"exemptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_portal_status" text DEFAULT 'not_required' NOT NULL,
	"supplier_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "procurement_profiles_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "provider_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_reference" text,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"term_months" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"overage_rate_minor" bigint NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_lines_values_check" CHECK ("quote_lines"."quantity" >= 0 and "quote_lines"."term_months" > 0 and "quote_lines"."unit_price_minor" >= 0 and "quote_lines"."overage_rate_minor" >= 0 and "quote_lines"."discount_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"end_client_account_id" uuid,
	"partner_account_id" uuid,
	"price_book_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"previous_revision_id" uuid,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"margin_floor_result" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"rendered_document_id" uuid,
	"partner_document_id" uuid,
	"partner_resale_total_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"immutable_at" timestamp with time zone,
	CONSTRAINT "quotes_total_nonnegative_check" CHECK ("quotes"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"approved_claim" text NOT NULL,
	"region" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"floor_price_minor" bigint,
	"overage_rate_minor" bigint NOT NULL,
	"minimum_quantity" numeric(38, 18) NOT NULL,
	"trial_limit" numeric(38, 18),
	"egress_treatment" text NOT NULL,
	"commit_type" text NOT NULL,
	"stripe_tax_code" text NOT NULL,
	"qbo_income_account" text NOT NULL,
	"partner_transfer_prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_card_price_check" CHECK ("rate_cards"."unit_price_minor" >= 0 and "rate_cards"."overage_rate_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_refund_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"report" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_event_id" text NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"provider_occurred_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_sync_events_workos_event_id_unique" UNIQUE("workos_event_id")
);
--> statement-breakpoint
CREATE TABLE "terminations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"final_billing_status" text NOT NULL,
	"teardown_status" text DEFAULT 'gated' NOT NULL,
	"deletion_scheduled_at" timestamp with time zone,
	"teardown_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_verified_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_identifier" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"trigger_run_id" text,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_partner_id_accounts_id_fk" FOREIGN KEY ("parent_partner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_templates" ADD CONSTRAINT "agreement_templates_canonical_document_id_documents_id_fk" FOREIGN KEY ("canonical_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_templates" ADD CONSTRAINT "agreement_templates_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_executed_document_id_documents_id_fk" FOREIGN KEY ("executed_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_superseded_by_id_agreements_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_signer_user_id_commerce_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_lines" ADD CONSTRAINT "amendment_lines_amendment_id_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_lines" ADD CONSTRAINT "amendment_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_statement_document_id_documents_id_fk" FOREIGN KEY ("statement_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_entries" ADD CONSTRAINT "commitment_entries_ledger_id_commitment_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."commitment_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_entries" ADD CONSTRAINT "commitment_entries_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_ledgers" ADD CONSTRAINT "commitment_ledgers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_ledgers" ADD CONSTRAINT "commitment_ledgers_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_end_client_account_id_accounts_id_fk" FOREIGN KEY ("end_client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_termination_id_terminations_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."terminations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_backup_user_id_commerce_users_id_fk" FOREIGN KEY ("backup_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_internal_user_id_commerce_users_id_fk" FOREIGN KEY ("internal_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_notices" ADD CONSTRAINT "inbound_notices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_notices" ADD CONSTRAINT "inbound_notices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_notices" ADD CONSTRAINT "inbound_notices_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_notices" ADD CONSTRAINT "inbound_notices_recorded_by_commerce_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_terms" ADD CONSTRAINT "key_terms_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novations" ADD CONSTRAINT "novations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novations" ADD CONSTRAINT "novations_former_partner_account_id_accounts_id_fk" FOREIGN KEY ("former_partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novations" ADD CONSTRAINT "novations_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novations" ADD CONSTRAINT "novations_new_agreement_id_agreements_id_fk" FOREIGN KEY ("new_agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novations" ADD CONSTRAINT "novations_new_order_id_orders_id_fk" FOREIGN KEY ("new_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."quote_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoicing_account_id_accounts_id_fk" FOREIGN KEY ("invoicing_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_po_document_id_documents_id_fk" FOREIGN KEY ("po_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_signer_user_id_commerce_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_form_document_id_documents_id_fk" FOREIGN KEY ("order_form_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_support_owner_id_commerce_users_id_fk" FOREIGN KEY ("support_owner_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_converted_quote_id_quotes_id_fk" FOREIGN KEY ("converted_quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_profiles" ADD CONSTRAINT "procurement_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_end_client_account_id_accounts_id_fk" FOREIGN KEY ("end_client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_previous_revision_id_quotes_id_fk" FOREIGN KEY ("previous_revision_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_commerce_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rendered_document_id_documents_id_fk" FOREIGN KEY ("rendered_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_partner_document_id_documents_id_fk" FOREIGN KEY ("partner_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_sync_events" ADD CONSTRAINT "role_sync_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_sync_events" ADD CONSTRAINT "role_sync_events_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_legal_entity_unique" ON "accounts" USING btree ("country","legal_name");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_domain_unique" ON "accounts" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_stripe_customer_unique" ON "accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_partner_idx" ON "accounts" USING btree ("parent_partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_templates_version_unique" ON "agreement_templates" USING btree ("type","semantic_version","jurisdiction");--> statement-breakpoint
CREATE INDEX "agreements_account_term_idx" ON "agreements" USING btree ("account_id","status","effective_on");--> statement-breakpoint
CREATE INDEX "amendments_order_effective_idx" ON "amendments" USING btree ("order_id","effective_on");--> statement-breakpoint
CREATE INDEX "approvals_pending_queue_idx" ON "approvals" USING btree ("action","status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_aggregate_version_unique" ON "audit_events" USING btree ("aggregate_type","aggregate_id","aggregate_version");--> statement-breakpoint
CREATE INDEX "audit_account_timeline_idx" ON "audit_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "commission_statement_queue_idx" ON "commission_accruals" USING btree ("partner_account_id","period","status");--> statement-breakpoint
CREATE UNIQUE INDEX "commitment_ledgers_period_unique" ON "commitment_ledgers" USING btree ("order_line_id","period_starts_at","period_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_records_entitlement_period_unique" ON "cost_records" USING btree ("entitlement_id","period","source");--> statement-breakpoint
CREATE INDEX "deal_registration_decision_queue_idx" ON "deal_registrations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_registration_active_unique" ON "deal_registrations" USING btree ("partner_account_id","end_client_account_id") WHERE "deal_registrations"."status" in ('registered','approved','disputed');--> statement-breakpoint
CREATE INDEX "disputes_evidence_queue_idx" ON "dispute_cases" USING btree ("status","evidence_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_content_hash_unique" ON "documents" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_version_unique" ON "documents" USING btree ("storage_key","storage_version_id");--> statement-breakpoint
CREATE INDEX "entitlements_org_status_idx" ON "entitlements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "entitlements_retention_idx" ON "entitlements" USING btree ("status","maximum_retention_at");--> statement-breakpoint
CREATE INDEX "exception_queue_idx" ON "exception_cases" USING btree ("queue","status","target_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exception_open_object_unique" ON "exception_cases" USING btree ("queue","object_type","object_id") WHERE "exception_cases"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_unique" ON "idempotency_records" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "impersonation_active_idx" ON "impersonation_sessions" USING btree ("internal_user_id","ended_at","expires_at");--> statement-breakpoint
CREATE INDEX "inbound_notices_renewal_gate_idx" ON "inbound_notices" USING btree ("order_id","type","served_on");--> statement-breakpoint
CREATE INDEX "invites_org_pending_idx" ON "invites" USING btree ("organization_id","accepted_at");--> statement-breakpoint
CREATE INDEX "invoices_account_aging_idx" ON "invoices" USING btree ("account_id","status","due_at");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_unique" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_workos_membership_id_unique" ON "memberships" USING btree ("workos_membership_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_account_timeline_idx" ON "orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_renewal_idx" ON "orders" USING btree ("status","notice_on","service_ends_on");--> statement-breakpoint
CREATE INDEX "orders_partner_renewal_idx" ON "orders" USING btree ("partner_account_id","service_ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_account_name_unique" ON "organizations" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "outbox_dispatch_queue_idx" ON "outbox_messages" USING btree ("processed_at","available_at","attempt_count");--> statement-breakpoint
CREATE INDEX "pocs_expiry_queue_idx" ON "pocs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_currency_version_unique" ON "price_books" USING btree ("currency","version");--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_one_active_currency_unique" ON "price_books" USING btree ("currency") WHERE "price_books"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operations_idempotency_unique" ON "provider_operations" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_operations_retry_queue_idx" ON "provider_operations" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_revision_unique" ON "quotes" USING btree ("series_id","revision");--> statement-breakpoint
CREATE INDEX "quotes_account_timeline_idx" ON "quotes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "quotes_queue_idx" ON "quotes" USING btree ("margin_floor_result","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_book_sku_region_unique" ON "rate_cards" USING btree ("price_book_id","sku","region");--> statement-breakpoint
CREATE INDEX "report_exports_queue_idx" ON "report_exports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "role_sync_processing_idx" ON "role_sync_events" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE INDEX "terminations_teardown_queue_idx" ON "terminations" USING btree ("teardown_status","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_provider_dedup_unique" ON "usage_events" USING btree ("entitlement_id","external_event_id");--> statement-breakpoint
CREATE INDEX "usage_events_meter_idx" ON "usage_events" USING btree ("entitlement_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_provider_dedup_unique" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_processing_queue_idx" ON "webhook_events" USING btree ("provider","processed_at","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_idempotency_unique" ON "workflow_runs" USING btree ("task_identifier","idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status","updated_at");

-- Domain checks that are intentionally explicit in the database as well as Zod.
alter table accounts add constraint accounts_relationship_roles_check
  check (relationship_roles <@ array['direct_client','partner','end_client']::text[]);
alter table memberships add constraint memberships_role_check check (role in (
  'owner','admin','billing','member','partner_admin','partner_seller','internal_operator',
  'finance_approver','legal_approver','destructive_action_approver'
));
alter table agreement_templates add constraint agreement_templates_execution_mode_check check (execution_mode in ('click_through','counter_signed'));
alter table agreement_templates add constraint agreement_templates_approval_status_check check (approval_status in ('draft','approved','retired'));
alter table agreements add constraint agreements_paper_check check (paper in ('ours','theirs'));
alter table agreements add constraint agreements_execution_mode_check check (execution_mode in ('click_through','counter_signed'));
alter table agreements add constraint agreements_renewal_type_check check (renewal_type in ('auto_renew','expires'));
alter table agreements add constraint agreements_status_check check (status in ('active','in_notice','expired','terminated'));
alter table price_books add constraint price_books_status_check check (status in ('draft','active','retired'));
alter table quotes add constraint quotes_status_check check (status in ('draft','issued','accepted','expired','superseded','rejected'));
alter table orders add constraint orders_status_check check (status in ('submitted','accepted','provisioning','active','amended','completed','cancelled','terminated'));
alter table orders add constraint orders_sourcing_check check (sourcing in ('direct','referral','resale'));
alter table pocs add constraint pocs_status_check check (status in ('proposed','approved','active','expired','converted','closed'));
alter table entitlements add constraint entitlements_status_check check (status in ('pending','active','suspended_write','terminated'));
alter table invoices add constraint invoices_status_check check (status in ('draft','open','paid','void','uncollectible'));
alter table payments add constraint payments_status_check check (status in ('pending','succeeded','failed','refunded'));
alter table credit_notes add constraint credit_notes_status_check check (status in ('issued','void'));
alter table refunds add constraint refunds_status_check check (status in ('pending','succeeded','failed'));
alter table dispute_cases add constraint dispute_cases_status_check check (status in ('needs_response','under_review','won','lost'));
alter table deal_registrations add constraint deal_registrations_status_check check (status in ('registered','approved','expired','converted','rejected','disputed'));
alter table commission_accruals add constraint commission_accruals_status_check check (status in ('accrued','stated','paid'));
alter table report_exports add constraint report_exports_status_check check (status in ('pending','running','complete','failed'));
alter table provider_operations add constraint provider_operations_status_check check (status in ('pending','running','succeeded','retrying','failed'));
alter table workflow_runs add constraint workflow_runs_status_check check (status in ('pending','running','succeeded','retrying','failed','cancelled'));
alter table rate_cards add constraint rate_cards_commit_type_check check (commit_type in ('period_allowance','term_drawdown'));
alter table commitment_ledgers add constraint commitment_ledgers_commit_type_check check (commit_type in ('period_allowance','term_drawdown'));
alter table approvals add constraint approvals_status_check check (status in ('pending','approved','rejected','expired'));
alter table approvals add constraint approvals_decision_check check (
  (status = 'pending' and approved_by is null and decided_at is null)
  or (status <> 'pending' and approved_by is not null and decided_at is not null)
);
alter table outbox_messages add constraint outbox_attempts_nonnegative_check check (attempt_count >= 0);
alter table webhook_events add constraint webhook_attempts_positive_check check (attempt_count > 0);
alter table order_lines add constraint order_lines_superseded_amendment_fk
  foreign key (superseded_by_amendment_id) references amendments(id);

create or replace function validate_quote_revision_chain() returns trigger
language plpgsql set search_path = public as $$
declare previous quotes%rowtype;
begin
  if not exists (select 1 from price_books p where p.id = new.price_book_id and p.currency = new.currency) then
    raise exception using errcode = '23514', message = 'quote currency must match its price book';
  end if;
  if new.previous_revision_id is null then
    if new.revision <> 1 then
      raise exception using errcode = '23514', message = 'first quote revision must be revision 1';
    end if;
  else
    select * into previous from quotes where id = new.previous_revision_id;
    if not found or previous.account_id <> new.account_id or previous.series_id <> new.series_id
      or new.revision <> previous.revision + 1 then
      raise exception using errcode = '23514', message = 'quote revision must follow the same account and series';
    end if;
  end if;
  return new;
end $$;
create constraint trigger quotes_revision_chain
after insert or update on quotes deferrable initially immediate
for each row execute function validate_quote_revision_chain();

create or replace function validate_commerce_chain() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'quote_lines' then
    if not exists (
      select 1 from quotes q join rate_cards r on r.id = new.rate_card_id
      where q.id = new.quote_id and q.price_book_id = r.price_book_id and r.sku = new.sku
    ) then raise exception using errcode = '23514', message = 'quote line must use the quote price book and rate-card SKU'; end if;
  elsif tg_table_name = 'orders' then
    if not exists (
      select 1 from quotes q join agreements a on a.id = new.agreement_id
      where q.id = new.quote_id and q.status = 'accepted' and a.status = 'active'
        and a.effective_on <= new.service_starts_on
        and (
          (new.sourcing = 'direct' and new.partner_account_id is null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id is null and a.account_id = new.account_id)
          or
          (new.sourcing = 'referral' and new.partner_account_id is not null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.account_id)
          or
          (new.sourcing = 'resale' and new.partner_account_id is not null
            and new.account_id <> new.partner_account_id and new.invoicing_account_id = new.partner_account_id
            and q.account_id = new.partner_account_id and q.end_client_account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.partner_account_id)
        )
    ) then raise exception using errcode = '23514', message = 'order quote/agreement/account merchant-of-record chain is inconsistent'; end if;
  elsif tg_table_name = 'order_lines' then
    if not exists (
      select 1 from orders o join quote_lines ql on ql.id = new.quote_line_id
      where o.id = new.order_id and ql.quote_id = o.quote_id and ql.sku = new.sku
        and ql.quantity = new.quantity and ql.unit_price_minor = new.unit_price_minor
        and ql.overage_rate_minor = new.overage_rate_minor
        and (new.superseded_by_amendment_id is null or exists (
          select 1 from amendments a where a.id = new.superseded_by_amendment_id and a.order_id = new.order_id
        ))
    ) then raise exception using errcode = '23514', message = 'order line must be copied from its order quote'; end if;
  elsif tg_table_name = 'commitment_ledgers' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
  elsif tg_table_name = 'entitlements' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
    if not exists (
      select 1 from orders o join organizations org on org.id = new.organization_id
      where o.id = new.order_id and org.account_id = o.account_id
    ) then raise exception using errcode = '23514', message = 'entitlement organization must belong to the service account'; end if;
  elsif tg_table_name = 'invoices' then
    if not exists (
      select 1 from orders o join quotes q on q.id = o.quote_id
      where o.id = new.order_id and o.invoicing_account_id = new.account_id and q.currency = new.currency
        and new.po_number is not distinct from o.po_number
    ) then raise exception using errcode = '23514', message = 'invoice account/currency must match the order merchant of record'; end if;
  elsif tg_table_name in ('payments', 'credit_notes') then
    if not exists (
      select 1 from invoices i where i.id = new.invoice_id and i.order_id = new.order_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'invoice adjustment must match its invoice order and currency'; end if;
  elsif tg_table_name in ('refunds', 'dispute_cases') then
    if not exists (
      select 1 from payments p where p.id = new.payment_id and p.order_id = new.order_id and p.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'payment adjustment must match its payment order and currency'; end if;
  elsif tg_table_name = 'inbound_notices' then
    if not exists (select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id)
    then raise exception using errcode = '23514', message = 'notice account must match its order'; end if;
  elsif tg_table_name = 'terminations' then
    if new.order_id is not null and not exists (
      select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'termination account must match its order'; end if;
  elsif tg_table_name = 'amendment_lines' then
    if new.order_line_id is not null and not exists (
      select 1 from amendments a join order_lines ol on ol.id = new.order_line_id
      where a.id = new.amendment_id and a.order_id = ol.order_id
    ) then raise exception using errcode = '23514', message = 'amendment line must belong to the amended order'; end if;
  elsif tg_table_name = 'commitment_entries' then
    if not exists (
      select 1
      from commitment_ledgers l
      join usage_events u on u.id = new.usage_event_id
      join entitlements e on e.id = u.entitlement_id
      where l.id = new.ledger_id and l.order_id = e.order_id and l.order_line_id = e.order_line_id
    ) then raise exception using errcode = '23514', message = 'usage event must belong to the commitment ledger order line'; end if;
  elsif tg_table_name = 'commission_accruals' then
    if not exists (
      select 1 from invoices i join orders o on o.id = i.order_id
      where i.id = new.invoice_id and o.sourcing = 'referral'
        and o.partner_account_id = new.partner_account_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'commission must belong to an attributed referral invoice'; end if;
  elsif tg_table_name = 'novations' then
    if not exists (
      select 1 from orders source_order join orders new_order on new_order.id = new.new_order_id
      join agreements new_agreement on new_agreement.id = new.new_agreement_id
      where source_order.id = new.source_order_id and source_order.account_id = new.account_id
        and source_order.partner_account_id = new.former_partner_account_id
        and new_order.account_id = new.account_id and new_agreement.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'novation must preserve the end-client artifact chain'; end if;
  end if;
  return new;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'quote_lines','orders','order_lines','commitment_ledgers','entitlements','invoices',
    'payments','credit_notes','refunds','dispute_cases','inbound_notices','terminations',
    'amendment_lines','commitment_entries','commission_accruals','novations'
  ] loop
    execute format(
      'create constraint trigger %I after insert or update on %I deferrable initially immediate for each row execute function validate_commerce_chain()',
      table_name || '_chain', table_name
    );
  end loop;
end $$;

create or replace function app_context_is_valid() returns boolean
language plpgsql stable security definer
set search_path = public, private, extensions
as $$
declare
  payload_text text := current_setting('app.authorization_context', true);
  signature text := current_setting('app.authorization_signature', true);
  claims jsonb;
  signature_valid boolean;
begin
  if coalesce(payload_text, '') = '' or coalesce(signature, '') = '' then
    return false;
  end if;
  claims := payload_text::jsonb;
  select bool_or(signature = encode(extensions.hmac(payload_text, secret, 'sha256'), 'hex'))
  into signature_valid from private.authorization_secrets where active;
  return coalesce(signature_valid, false)
    and (claims->>'expiresAt')::timestamptz > clock_timestamp()
    and jsonb_typeof(claims->'accountIds') = 'array'
    and jsonb_typeof(claims->'roles') = 'array'
    and nullif(claims->>'userId', '') is not null
    and nullif(claims->>'requestId', '') is not null;
exception when others then
  return false;
end
$$;
revoke all on function app_context_is_valid() from public;
grant execute on function app_context_is_valid() to clockwork_runtime, clockwork_service;

create or replace function app_context_claims() returns jsonb
language plpgsql stable set search_path = public
as $$
begin
  if not app_context_is_valid() then return '{}'::jsonb; end if;
  return current_setting('app.authorization_context', true)::jsonb;
exception when others then
  return '{}'::jsonb;
end
$$;

create or replace function app_is_internal() returns boolean
language sql stable set search_path = public
as $$ select current_user = 'clockwork_service' $$;

create or replace function app_has_account(candidate uuid) returns boolean
language sql stable set search_path = public
as $$
  select app_is_internal()
    or candidate::text in (
      select jsonb_array_elements_text(app_context_claims()->'accountIds')
    )
$$;

create or replace function app_is_current_user(candidate uuid) returns boolean
language sql stable set search_path = public
as $$ select app_is_internal() or candidate::text = coalesce(app_context_claims()->>'userId', '') $$;

-- RLS is mandatory. The API supplies transaction-local authorization context; migration tooling uses a direct owner connection.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','documents','procurement_profiles','organizations','commerce_users','memberships','invites',
    'agreement_templates','agreements','key_terms','price_books','rate_cards','quotes','quote_lines','pocs','orders','order_lines',
    'amendments','amendment_lines','commitment_ledgers','commitment_entries','entitlements','usage_events','invoices','payments',
    'credit_notes','refunds','dispute_cases','inbound_notices','terminations','deletion_certificates','deal_registrations','novations',
    'commission_accruals','exception_cases','approvals','cost_records','report_exports','audit_events','outbox_messages',
    'idempotency_records','webhook_events','provider_operations','workflow_runs','impersonation_sessions','role_sync_events'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
  end loop;
end $$;

create policy accounts_scope on accounts for all using (app_has_account(id)) with check (app_has_account(id));
create policy documents_scope on documents for all using (account_id is null and app_is_internal() or app_has_account(account_id)) with check (account_id is null and app_is_internal() or app_has_account(account_id));
create policy procurement_profiles_scope on procurement_profiles for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy organizations_scope on organizations for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy commerce_users_read on commerce_users for select using (app_is_current_user(id));
create policy commerce_users_service on commerce_users for all using (app_is_internal()) with check (app_is_internal());
create policy memberships_read on memberships for select using (exists (select 1 from organizations o where o.id = organization_id and app_has_account(o.account_id)));
create policy memberships_service on memberships for all using (app_is_internal()) with check (app_is_internal());
create policy invites_scope on invites for all using (exists (select 1 from organizations o where o.id = organization_id and app_has_account(o.account_id))) with check (exists (select 1 from organizations o where o.id = organization_id and app_has_account(o.account_id)));

create policy agreement_templates_read on agreement_templates for select using (app_is_internal() or approval_status = 'approved');
create policy agreement_templates_write on agreement_templates for all using (app_is_internal()) with check (app_is_internal());
create policy agreements_scope on agreements for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy key_terms_scope on key_terms for all using (exists (select 1 from agreements a where a.id = agreement_id and app_has_account(a.account_id))) with check (exists (select 1 from agreements a where a.id = agreement_id and app_has_account(a.account_id)));
create policy price_books_read on price_books for select using (app_is_internal() or status = 'active');
create policy price_books_write on price_books for all using (app_is_internal()) with check (app_is_internal());
create policy rate_cards_read on rate_cards for select using (app_is_internal() or exists (select 1 from price_books p where p.id = price_book_id and p.status = 'active'));
create policy rate_cards_write on rate_cards for all using (app_is_internal()) with check (app_is_internal());
create policy quotes_scope on quotes for all using (app_has_account(account_id) or app_has_account(partner_account_id)) with check (app_has_account(account_id) or app_has_account(partner_account_id));
create policy quote_lines_scope on quote_lines for all using (exists (select 1 from quotes q where q.id = quote_id and (app_has_account(q.account_id) or app_has_account(q.partner_account_id)))) with check (exists (select 1 from quotes q where q.id = quote_id and (app_has_account(q.account_id) or app_has_account(q.partner_account_id))));
create policy pocs_scope on pocs for all using (app_has_account(account_id) or app_has_account(partner_account_id)) with check (app_has_account(account_id) or app_has_account(partner_account_id));
create policy orders_scope on orders for all using (
  app_is_internal() or app_has_account(invoicing_account_id) or app_has_account(partner_account_id)
  or (sourcing <> 'resale' and app_has_account(account_id))
) with check (
  app_is_internal() or app_has_account(invoicing_account_id) or app_has_account(partner_account_id)
  or (sourcing <> 'resale' and app_has_account(account_id))
);
create policy order_lines_scope on order_lines for all using (exists (select 1 from orders o where o.id = order_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
))) with check (exists (select 1 from orders o where o.id = order_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
)));
create policy amendments_scope on amendments for all using (exists (select 1 from orders o where o.id = order_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
))) with check (exists (select 1 from orders o where o.id = order_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
)));
create policy amendment_lines_scope on amendment_lines for all using (exists (select 1 from amendments a join orders o on o.id = a.order_id where a.id = amendment_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
))) with check (exists (select 1 from amendments a join orders o on o.id = a.order_id where a.id = amendment_id and (
  app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
  or (o.sourcing <> 'resale' and app_has_account(o.account_id))
)));
create policy commitment_ledgers_scope on commitment_ledgers for all using (exists (select 1 from orders o where o.id = order_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)))) with check (exists (select 1 from orders o where o.id = order_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id))));
create policy commitment_entries_scope on commitment_entries for all using (exists (select 1 from commitment_ledgers l join orders o on o.id = l.order_id where l.id = ledger_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)))) with check (exists (select 1 from commitment_ledgers l join orders o on o.id = l.order_id where l.id = ledger_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id))));
create policy entitlements_scope on entitlements for all using (exists (select 1 from orders o where o.id = order_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)))) with check (exists (select 1 from orders o where o.id = order_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id))));
create policy usage_events_scope on usage_events for all using (exists (select 1 from entitlements e join orders o on o.id = e.order_id where e.id = entitlement_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)))) with check (exists (select 1 from entitlements e join orders o on o.id = e.order_id where e.id = entitlement_id and (app_has_account(o.account_id) or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id))));

create policy invoices_scope on invoices for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy payments_scope on payments for all using (exists (select 1 from invoices i where i.id = invoice_id and app_has_account(i.account_id))) with check (exists (select 1 from invoices i where i.id = invoice_id and app_has_account(i.account_id)));
create policy credit_notes_scope on credit_notes for all using (exists (select 1 from invoices i where i.id = invoice_id and app_has_account(i.account_id))) with check (exists (select 1 from invoices i where i.id = invoice_id and app_has_account(i.account_id)));
create policy refunds_scope on refunds for all using (exists (select 1 from payments p join invoices i on i.id = p.invoice_id where p.id = payment_id and app_has_account(i.account_id))) with check (exists (select 1 from payments p join invoices i on i.id = p.invoice_id where p.id = payment_id and app_has_account(i.account_id)));
create policy dispute_cases_scope on dispute_cases for all using (exists (select 1 from payments p join invoices i on i.id = p.invoice_id where p.id = payment_id and app_has_account(i.account_id))) with check (exists (select 1 from payments p join invoices i on i.id = p.invoice_id where p.id = payment_id and app_has_account(i.account_id)));
create policy inbound_notices_scope on inbound_notices for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy terminations_scope on terminations for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy deletion_certificates_scope on deletion_certificates for all using (exists (select 1 from terminations t where t.id = termination_id and app_has_account(t.account_id))) with check (exists (select 1 from terminations t where t.id = termination_id and app_has_account(t.account_id)));
create policy deal_registrations_scope on deal_registrations for all using (app_has_account(partner_account_id)) with check (app_has_account(partner_account_id));
create policy novations_scope on novations for all using (app_has_account(account_id) or app_has_account(former_partner_account_id)) with check (app_has_account(account_id) or app_has_account(former_partner_account_id));
create policy commission_accruals_scope on commission_accruals for all using (app_has_account(partner_account_id)) with check (app_has_account(partner_account_id));
create policy exception_cases_scope on exception_cases for all using (app_is_internal() or app_has_account(account_id)) with check (app_is_internal());
create policy approvals_scope on approvals for all using (app_is_internal() or app_has_account(account_id)) with check (app_is_internal());
create policy cost_records_scope on cost_records for all using (app_is_internal()) with check (app_is_internal());
create policy report_exports_scope on report_exports for all using (app_is_internal() or app_is_current_user(requested_by)) with check (app_is_internal() or app_is_current_user(requested_by));
create policy audit_events_scope on audit_events for select using (app_is_internal() or app_has_account(account_id));

-- Operational tables are service-only. They hold retries, secrets-derived hashes, and cross-account work.
create policy audit_events_insert on audit_events for insert with check (app_is_internal() or app_has_account(account_id));
create policy outbox_internal on outbox_messages for select using (app_is_internal());
create policy outbox_tenant_append on outbox_messages for insert with check (
  app_is_internal() or exists (
    select 1 from audit_events event
    where event.id = event_id and app_has_account(event.account_id)
  )
);
create policy outbox_internal_mutation on outbox_messages for update using (app_is_internal()) with check (app_is_internal());
create policy outbox_internal_delete on outbox_messages for delete using (app_is_internal());
create policy idempotency_internal on idempotency_records for all using (app_is_internal()) with check (app_is_internal());
create policy webhook_internal on webhook_events for all using (app_is_internal()) with check (app_is_internal());
create policy provider_operations_internal on provider_operations for all using (app_is_internal()) with check (app_is_internal());
create policy workflow_runs_internal on workflow_runs for all using (app_is_internal()) with check (app_is_internal());
create policy impersonation_internal on impersonation_sessions for all using (app_is_internal()) with check (app_is_internal());
create policy role_sync_internal on role_sync_events for all using (app_is_internal()) with check (app_is_internal());

grant usage on schema public to clockwork_runtime, clockwork_service;
grant usage on schema extensions to clockwork_runtime, clockwork_service;
grant select, insert, update, delete on all tables in schema public to clockwork_runtime, clockwork_service;
grant usage, select on all sequences in schema public to clockwork_runtime, clockwork_service;
alter default privileges in schema public grant select, insert, update, delete on tables to clockwork_runtime, clockwork_service;
alter default privileges in schema public grant usage, select on sequences to clockwork_runtime, clockwork_service;
revoke insert, update, delete on commerce_users, memberships from clockwork_runtime;

create or replace function deny_immutable_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = format('%s is append-only/immutable', tg_table_name);
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'documents','key_terms','amendments','amendment_lines',
    'commitment_entries','usage_events','credit_notes','refunds','inbound_notices','deletion_certificates',
    'novations','commission_accruals','cost_records','audit_events'
  ] loop
    execute format('create trigger %I before update or delete on %I for each row execute function deny_immutable_mutation()', table_name || '_immutable', table_name);
  end loop;
end $$;

create or replace function protect_issued_quote() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception using errcode = '55000', message = 'issued quotes are immutable'; end if;
    return old;
  end if;
  if new.account_id is distinct from old.account_id or new.end_client_account_id is distinct from old.end_client_account_id or
    new.partner_account_id is distinct from old.partner_account_id or
    new.price_book_id is distinct from old.price_book_id or new.series_id is distinct from old.series_id or
    new.previous_revision_id is distinct from old.previous_revision_id or new.revision is distinct from old.revision or
    new.currency is distinct from old.currency or new.created_at is distinct from old.created_at or
    new.immutable_at is distinct from old.immutable_at
  then raise exception using errcode = '55000', message = 'quote chain identity and evidence timestamps are immutable'; end if;
  if old.status <> 'draft' and (
    new.total_minor is distinct from old.total_minor or new.margin_floor_result is distinct from old.margin_floor_result or
    new.expires_at is distinct from old.expires_at or new.created_by is distinct from old.created_by or
    new.rendered_document_id is distinct from old.rendered_document_id or new.partner_document_id is distinct from old.partner_document_id or
    new.partner_resale_total_minor is distinct from old.partner_resale_total_minor
  ) then raise exception using errcode = '55000', message = 'issued quote commercial terms are immutable'; end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('issued','rejected')) or
    (old.status = 'issued' and new.status in ('accepted','expired','superseded','rejected')) or
    (old.status = 'accepted' and new.status = 'superseded')
  ) then raise exception using errcode = '23514', message = 'invalid quote status transition'; end if;
  if new.status <> 'draft' then new.immutable_at := coalesce(new.immutable_at, now()); end if;
  return new;
end $$;
create trigger quotes_immutable before delete on quotes for each row execute function protect_issued_quote();
create trigger quotes_immutable_update before update on quotes for each row execute function protect_issued_quote();

create or replace function protect_quote_line() returns trigger
language plpgsql set search_path = public as $$
declare quote_status text;
begin
  select status into quote_status from quotes where id = old.quote_id;
  if quote_status <> 'draft' then
    raise exception using errcode = '55000', message = 'issued quote lines are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger quote_lines_immutable before update or delete on quote_lines for each row execute function protect_quote_line();

create or replace function protect_agreement_template() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'agreement templates are immutable artifacts';
  end if;
  if new.type is distinct from old.type or new.semantic_version is distinct from old.semantic_version or
    new.jurisdiction is distinct from old.jurisdiction or new.effective_on is distinct from old.effective_on or
    new.canonical_document_id is distinct from old.canonical_document_id or new.text_hash is distinct from old.text_hash or
    new.execution_mode is distinct from old.execution_mode or new.version is distinct from old.version or
    new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000', message = 'agreement template artifacts are immutable; create a version';
  end if;
  if old.approval_status <> 'draft' and new.approved_by is distinct from old.approved_by then
    raise exception using errcode = '55000', message = 'agreement template approval evidence is immutable';
  end if;
  if new.approval_status is distinct from old.approval_status and not (
    (old.approval_status = 'draft' and new.approval_status in ('approved','retired')) or
    (old.approval_status = 'approved' and new.approval_status = 'retired')
  ) then raise exception using errcode = '23514', message = 'invalid agreement template status transition'; end if;
  if new.approval_status = 'approved' and new.approved_by is null then
    raise exception using errcode = '23514', message = 'approved template requires approved_by';
  end if;
  return new;
end $$;
create trigger agreement_templates_lifecycle before update or delete on agreement_templates for each row execute function protect_agreement_template();

create or replace function protect_agreement() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'agreements are append-only/immutable';
  end if;
  if new.account_id is distinct from old.account_id or new.template_id is distinct from old.template_id or
    new.paper is distinct from old.paper or new.execution_mode is distinct from old.execution_mode or
    new.executed_document_id is distinct from old.executed_document_id or new.evidence_document_id is distinct from old.evidence_document_id or
    new.envelope_id is distinct from old.envelope_id or new.negotiation_status is distinct from old.negotiation_status or
    new.effective_on is distinct from old.effective_on or new.term_months is distinct from old.term_months or
    new.renewal_type is distinct from old.renewal_type or new.notice_days is distinct from old.notice_days or
    new.signer_user_id is distinct from old.signer_user_id or new.authority_title is distinct from old.authority_title or
    new.authority_attested is distinct from old.authority_attested or new.accepted_ip is distinct from old.accepted_ip or
    new.accepted_user_agent is distinct from old.accepted_user_agent or new.text_hash is distinct from old.text_hash or
    new.version is distinct from old.version or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000', message = 'executed agreement evidence is immutable; create a version';
  end if;
  if new.superseded_by_id is distinct from old.superseded_by_id and new.superseded_by_id is not null and not exists (
    select 1 from agreements successor
    where successor.id = new.superseded_by_id and successor.account_id = old.account_id
      and successor.id <> old.id and successor.effective_on >= old.effective_on
  ) then raise exception using errcode = '23514', message = 'agreement successor must be a later agreement for the same account'; end if;
  return new;
end $$;
create trigger agreements_lifecycle before update or delete on agreements for each row execute function protect_agreement();

create or replace function protect_accepted_order() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'submitted' then
      raise exception using errcode = '55000', message = 'accepted orders are immutable; use an amendment';
    end if;
    return old;
  end if;
  if new.created_at is distinct from old.created_at or new.immutable_at is distinct from old.immutable_at then
    raise exception using errcode = '55000', message = 'accepted order evidence timestamps are immutable';
  end if;
  if old.status <> 'submitted' and (
    new.quote_id is distinct from old.quote_id or new.agreement_id is distinct from old.agreement_id or
    new.account_id is distinct from old.account_id or new.invoicing_account_id is distinct from old.invoicing_account_id or
    new.partner_account_id is distinct from old.partner_account_id or new.sourcing is distinct from old.sourcing or
    new.po_number is distinct from old.po_number or new.po_document_id is distinct from old.po_document_id or
    new.signer_user_id is distinct from old.signer_user_id or new.authority_title is distinct from old.authority_title or
    new.authority_attested is distinct from old.authority_attested or new.service_starts_on is distinct from old.service_starts_on or
    new.service_ends_on is distinct from old.service_ends_on or new.notice_on is distinct from old.notice_on or
    new.order_form_document_id is distinct from old.order_form_document_id
  ) then
    raise exception using errcode = '55000', message = 'accepted order commercial terms are immutable; use an amendment';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'submitted' and new.status in ('accepted','cancelled')) or
    (old.status = 'accepted' and new.status in ('provisioning','cancelled')) or
    (old.status = 'provisioning' and new.status in ('active','cancelled')) or
    (old.status = 'active' and new.status in ('amended','completed','terminated')) or
    (old.status = 'amended' and new.status in ('active','completed','terminated'))
  ) then raise exception using errcode = '23514', message = 'invalid order status transition'; end if;
  if new.status <> 'submitted' then new.immutable_at := coalesce(new.immutable_at, now()); end if;
  return new;
end $$;
create trigger orders_immutable_terms before update or delete on orders for each row execute function protect_accepted_order();

create or replace function protect_order_line() returns trigger
language plpgsql set search_path = public as $$
declare order_status text;
begin
  select status into order_status from orders where id = old.order_id;
  if order_status <> 'submitted' then
    if tg_op = 'DELETE' or
      new.order_id is distinct from old.order_id or new.quote_line_id is distinct from old.quote_line_id or
      new.sku is distinct from old.sku or new.quantity is distinct from old.quantity or
      new.unit_price_minor is distinct from old.unit_price_minor or new.overage_rate_minor is distinct from old.overage_rate_minor
    then
      raise exception using errcode = '55000', message = 'accepted order lines are immutable; use an amendment';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger order_lines_immutable before update or delete on order_lines for each row execute function protect_order_line();

create or replace function protect_published_pricing() returns trigger
language plpgsql set search_path = public as $$
declare book_status text;
begin
  if tg_table_name = 'price_books' then
    if tg_op = 'DELETE' and old.status <> 'draft' then
      raise exception using errcode = '55000', message = 'published price books are immutable; create a version';
    end if;
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      if not (
        old.status = 'active' and new.status = 'retired' and
        new.id is not distinct from old.id and new.name is not distinct from old.name and
        new.currency is not distinct from old.currency and new.effective_from is not distinct from old.effective_from and
        new.created_at is not distinct from old.created_at and new.version is not distinct from old.version
      ) then
        raise exception using errcode = '55000', message = 'published price books are immutable; create a version';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status in ('active','retired')) or
      (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception using errcode = '23514', message = 'invalid price book status transition';
    end if;
  else
    select status into book_status from price_books where id = old.price_book_id;
    if book_status <> 'draft' then
      raise exception using errcode = '55000', message = 'published rate cards are immutable; create a price book version';
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  return new;
end $$;
create trigger price_books_immutable before update or delete on price_books for each row execute function protect_published_pricing();
create trigger rate_cards_immutable before update or delete on rate_cards for each row execute function protect_published_pricing();

create or replace function protect_identity_link() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'organizations' and new.account_id is distinct from old.account_id then
    raise exception using errcode = '55000', message = 'organization account ownership is immutable';
  elsif tg_table_name = 'memberships' and (
    new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id
  ) then raise exception using errcode = '55000', message = 'membership identity is immutable; replace the membership';
  end if;
  return new;
end $$;
create trigger organizations_identity_immutable before update on organizations for each row execute function protect_identity_link();
create trigger memberships_identity_immutable before update on memberships for each row execute function protect_identity_link();

create or replace function touch_versioned_row() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','procurement_profiles','organizations','commerce_users','memberships','invites','quotes','pocs','orders',
    'commitment_ledgers','entitlements','invoices','payments','dispute_cases','terminations','deal_registrations',
    'exception_cases','approvals','report_exports','provider_operations','workflow_runs'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function touch_versioned_row()', table_name || '_version', table_name);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated, service_role;
