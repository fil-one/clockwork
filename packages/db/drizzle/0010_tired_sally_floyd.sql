CREATE TABLE "core_customer_acquisition_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"trial_id" uuid,
	"enrollment_id" uuid,
	"resolved_by" uuid,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_price_book_schedules" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"approved_row_version" integer NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_reason" text,
	"cancelled_by" uuid,
	CONSTRAINT "core_price_schedule_status_check" CHECK ("core_price_book_schedules"."status" in ('approved','executed','cancelled','expired')),
	CONSTRAINT "core_price_schedule_window_check" CHECK ("core_price_book_schedules"."effective_to" is null or "core_price_book_schedules"."effective_to" >= "core_price_book_schedules"."effective_from"),
	CONSTRAINT "core_price_schedule_completion_check" CHECK (("core_price_book_schedules"."status"='approved' and "core_price_book_schedules"."completed_at" is null and "core_price_book_schedules"."completion_reason" is null and "core_price_book_schedules"."cancelled_by" is null) or ("core_price_book_schedules"."status"<>'approved' and "core_price_book_schedules"."completed_at" is not null and "core_price_book_schedules"."completion_reason" is not null and length(trim("core_price_book_schedules"."completion_reason"))>0 and (("core_price_book_schedules"."status"='cancelled')=("core_price_book_schedules"."cancelled_by" is not null))))
);
--> statement-breakpoint
CREATE TABLE "core_channel_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"terms" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"last_edited_by" uuid NOT NULL,
	"proposed_by" uuid,
	"approved_by" uuid,
	"approval_evidence" text,
	"decision_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_channel_policy_versions_row_version_check" CHECK ("core_channel_policy_versions"."row_version">0),
	CONSTRAINT "core_channel_policy_versions_status_check" CHECK ("core_channel_policy_versions"."status" in ('draft','proposed','approved')),
	CONSTRAINT "channel_policy_terms_check" CHECK (
    jsonb_typeof("core_channel_policy_versions"."terms")='object' and "core_channel_policy_versions"."terms" ?& array['version','effectiveFrom','selfServeThresholdTb','defaultProtectionDays','maximumProtectionDays','extensionDays','maximumExtensions','sourceEvidence']
    and jsonb_typeof("core_channel_policy_versions"."terms"->'version')='number' and "core_channel_policy_versions"."terms"->>'version' ~ '^[0-9]+$'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'selfServeThresholdTb')='number'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'effectiveFrom')='string' and jsonb_typeof("core_channel_policy_versions"."terms"->'sourceEvidence')='string'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'defaultProtectionDays')='number' and "core_channel_policy_versions"."terms"->>'defaultProtectionDays' ~ '^[0-9]+$'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'maximumProtectionDays')='number' and "core_channel_policy_versions"."terms"->>'maximumProtectionDays' ~ '^[0-9]+$'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'extensionDays')='number' and "core_channel_policy_versions"."terms"->>'extensionDays' ~ '^[0-9]+$'
    and jsonb_typeof("core_channel_policy_versions"."terms"->'maximumExtensions')='number' and "core_channel_policy_versions"."terms"->>'maximumExtensions' ~ '^[0-9]+$'
    and ("core_channel_policy_versions"."terms"->>'version')::integer>0 and ("core_channel_policy_versions"."terms"->>'effectiveFrom') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and ("core_channel_policy_versions"."terms"->>'effectiveFrom')::date is not null
    and ("core_channel_policy_versions"."terms"->>'selfServeThresholdTb')::numeric>0 and ("core_channel_policy_versions"."terms"->>'selfServeThresholdTb')::numeric<=1000000000
    and ("core_channel_policy_versions"."terms"->>'defaultProtectionDays')::integer between 1 and 730
    and ("core_channel_policy_versions"."terms"->>'maximumProtectionDays')::integer between ("core_channel_policy_versions"."terms"->>'defaultProtectionDays')::integer and 730
    and ("core_channel_policy_versions"."terms"->>'extensionDays')::integer between 1 and 730
    and ("core_channel_policy_versions"."terms"->>'maximumExtensions')::integer between 0 and 10
    and length(trim("core_channel_policy_versions"."terms"->>'sourceEvidence'))>=8
  ),
	CONSTRAINT "channel_policy_approval_check" CHECK ("core_channel_policy_versions"."status"<>'approved' or (
    "core_channel_policy_versions"."approved_by" is not null and "core_channel_policy_versions"."proposed_by" is not null and "core_channel_policy_versions"."approved_by"<>"core_channel_policy_versions"."created_by" and "core_channel_policy_versions"."approved_by"<>"core_channel_policy_versions"."last_edited_by"
    and "core_channel_policy_versions"."approved_by"<>"core_channel_policy_versions"."proposed_by" and "core_channel_policy_versions"."approval_evidence" is not null and length(trim("core_channel_policy_versions"."approval_evidence"))>=8
  ))
);
--> statement-breakpoint
CREATE TABLE "core_referral_commission_policy_snapshots" (
	"quote_id" uuid PRIMARY KEY NOT NULL,
	"partner_account_id" uuid NOT NULL,
	"account_row_version" integer NOT NULL,
	"rate_bps" integer,
	"holdback_bps" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_referral_policy_basis_points_check" CHECK (("core_referral_commission_policy_snapshots"."rate_bps" is null) = ("core_referral_commission_policy_snapshots"."holdback_bps" is null) and ("core_referral_commission_policy_snapshots"."rate_bps" is null or ("core_referral_commission_policy_snapshots"."rate_bps" between 0 and 10000 and "core_referral_commission_policy_snapshots"."holdback_bps" between 0 and 10000)))
);
--> statement-breakpoint
CREATE TABLE "core_payg_offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"sku" text NOT NULL,
	"region" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"terms" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"last_edited_by" uuid NOT NULL,
	"proposed_by" uuid,
	"approved_by" uuid,
	"approval_evidence_id" text,
	"decision_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_payg_offer_status_check" CHECK ("core_payg_offer_versions"."status" in ('draft','proposed','approved','retired')),
	CONSTRAINT "core_payg_offer_version_check" CHECK ("core_payg_offer_versions"."version" > 0 and "core_payg_offer_versions"."row_version" > 0),
	CONSTRAINT "core_payg_offer_approval_check" CHECK ("core_payg_offer_versions"."status" not in ('approved','retired') or ("core_payg_offer_versions"."approved_by" is not null and "core_payg_offer_versions"."proposed_by" is not null and "core_payg_offer_versions"."approved_by" <> "core_payg_offer_versions"."proposed_by" and "core_payg_offer_versions"."approved_by" <> "core_payg_offer_versions"."created_by" and "core_payg_offer_versions"."approved_by" <> "core_payg_offer_versions"."last_edited_by" and "core_payg_offer_versions"."approval_evidence_id" is not null and length(trim("core_payg_offer_versions"."approval_evidence_id")) > 0)),
	CONSTRAINT "core_payg_offer_terms_binding_check" CHECK (jsonb_typeof("core_payg_offer_versions"."terms") = 'object' and "core_payg_offer_versions"."terms"->>'sku' is not null and "core_payg_offer_versions"."terms"->>'region' is not null and "core_payg_offer_versions"."terms"->>'version' is not null and "core_payg_offer_versions"."terms"->>'sku' = "core_payg_offer_versions"."sku" and "core_payg_offer_versions"."terms"->>'region' = "core_payg_offer_versions"."region" and ("core_payg_offer_versions"."terms"->>'version')::integer = "core_payg_offer_versions"."version")
);
--> statement-breakpoint
CREATE TABLE "core_payg_credit_sources" (
	"credit_note_id" uuid PRIMARY KEY NOT NULL,
	"effect_key" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"allocation_index" integer NOT NULL,
	"net_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_payg_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_entitlement_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"binding_evidence_id" text NOT NULL,
	"cancellation_evidence_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_payg_invoice_sources" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"effect_key" text NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_payg_invoice_sources_effect_key_unique" UNIQUE("effect_key")
);
--> statement-breakpoint
CREATE TABLE "core_payg_pending_invoice_effects" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_payg_period_revisions" (
	"enrollment_id" uuid NOT NULL,
	"month" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_payg_period_revisions_enrollment_id_month_revision_pk" PRIMARY KEY("enrollment_id","month","revision"),
	CONSTRAINT "core_payg_period_revision_positive" CHECK ("core_payg_period_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "core_payg_source_measurements" (
	"enrollment_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_measurement_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_payg_source_measurements_source_source_measurement_id_pk" PRIMARY KEY("source","source_measurement_id")
);
--> statement-breakpoint
CREATE TABLE "core_payg_source_receipts" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"verification_evidence_id" text NOT NULL,
	"closed_through" timestamp with time zone NOT NULL,
	"complete_count_meters" text[] NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_trial_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"verified_domain" text NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"verification_evidence_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_trial_claims_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "core_trial_claims_verified_domain_unique" UNIQUE("verified_domain")
);
--> statement-breakpoint
CREATE TABLE "core_trial_counter_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"verification_evidence_id" text NOT NULL,
	"counters" jsonb NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_trial_reservation_settlements" (
	"reservation_id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"outcome" text NOT NULL,
	"actual_bytes" text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_trial_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_id" uuid NOT NULL,
	"operation" jsonb NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"counter_receipt_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_capability_requests" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"capability_key" text NOT NULL,
	"base_version" integer NOT NULL,
	"enable_recovery" boolean NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	CONSTRAINT "system_capability_requests_status_check" CHECK ("system_capability_requests"."status" in ('pending','approved','rejected','canceled')),
	CONSTRAINT "system_capability_requests_separation_check" CHECK ("system_capability_requests"."status" <> 'approved' or "system_capability_requests"."decided_by" <> "system_capability_requests"."requested_by"),
	CONSTRAINT "system_capability_requests_decision_check" CHECK (("system_capability_requests"."status" = 'pending' and "system_capability_requests"."decided_by" is null and "system_capability_requests"."decided_at" is null and "system_capability_requests"."decision_reason" is null) or ("system_capability_requests"."status" <> 'pending' and "system_capability_requests"."decided_by" is not null and "system_capability_requests"."decided_at" is not null and length(trim("system_capability_requests"."decision_reason")) >= 8)),
	CONSTRAINT "system_capability_requests_reason_check" CHECK (length(trim("system_capability_requests"."reason")) >= 8 and length(trim("system_capability_requests"."evidence_reference")) > 0 and "system_capability_requests"."base_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "system_production_bootstraps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"manifest_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"applied_by" uuid NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "system_production_bootstraps_manifest_hash_check" CHECK ("system_production_bootstraps"."manifest_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "system_production_bootstraps_manifest_check" CHECK (jsonb_typeof("system_production_bootstraps"."manifest") = 'object')
);
--> statement-breakpoint
CREATE TABLE "system_provider_connection_references" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"provider" text NOT NULL,
	"secret_reference" text NOT NULL,
	"secret_version" text NOT NULL,
	"rotated_at" timestamp with time zone NOT NULL,
	"owner" text NOT NULL,
	"review_interval_days" integer NOT NULL,
	"source_evidence" text NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_provider_connection_references_provider_check" CHECK ("system_provider_connection_references"."provider" in ('billing','accounting','notifications','usage','workos','evidence','provisioning','screening','signature','tax','crm','document_renderer')),
	CONSTRAINT "system_provider_connection_references_version_check" CHECK ("system_provider_connection_references"."row_version" > 0),
	CONSTRAINT "system_provider_connection_references_interval_check" CHECK ("system_provider_connection_references"."review_interval_days" between 1 and 730),
	CONSTRAINT "system_provider_connection_references_reference_check" CHECK ("system_provider_connection_references"."secret_reference" ~ '^(secret|vault|arn):[A-Za-z0-9_./:-]+$' and length("system_provider_connection_references"."secret_reference") <= 1000),
	CONSTRAINT "system_provider_connection_references_text_check" CHECK (length(trim("system_provider_connection_references"."owner")) between 1 and 200 and length(trim("system_provider_connection_references"."secret_version")) between 1 and 200 and length(trim("system_provider_connection_references"."source_evidence")) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute_cases" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core_stripe_adjustment_operations" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD COLUMN "channel_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD COLUMN "policy_extension_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD COLUMN "extension_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_source" text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payg_effect_key" text;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_offer_version_id_core_payg_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."core_payg_offer_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_trial_id_core_trial_claims_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."core_trial_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_customer_acquisition_requests" ADD CONSTRAINT "core_customer_acquisition_requests_resolved_by_commerce_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_schedules" ADD CONSTRAINT "core_price_book_schedules_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_schedules" ADD CONSTRAINT "core_price_book_schedules_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_schedules" ADD CONSTRAINT "core_price_book_schedules_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_price_book_schedules" ADD CONSTRAINT "core_price_book_schedules_cancelled_by_commerce_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_channel_policy_versions" ADD CONSTRAINT "core_channel_policy_versions_created_by_commerce_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_channel_policy_versions" ADD CONSTRAINT "core_channel_policy_versions_last_edited_by_commerce_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_channel_policy_versions" ADD CONSTRAINT "core_channel_policy_versions_proposed_by_commerce_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_channel_policy_versions" ADD CONSTRAINT "core_channel_policy_versions_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_referral_commission_policy_snapshots" ADD CONSTRAINT "core_referral_commission_policy_snapshots_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_referral_commission_policy_snapshots" ADD CONSTRAINT "core_referral_commission_policy_snapshots_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_offer_versions" ADD CONSTRAINT "core_payg_offer_versions_created_by_commerce_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_offer_versions" ADD CONSTRAINT "core_payg_offer_versions_last_edited_by_commerce_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_offer_versions" ADD CONSTRAINT "core_payg_offer_versions_proposed_by_commerce_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_offer_versions" ADD CONSTRAINT "core_payg_offer_versions_approved_by_commerce_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_credit_sources" ADD CONSTRAINT "core_payg_credit_sources_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_credit_sources" ADD CONSTRAINT "core_payg_credit_sources_effect_key_core_payg_pending_invoice_effects_idempotency_key_fk" FOREIGN KEY ("effect_key") REFERENCES "public"."core_payg_pending_invoice_effects"("idempotency_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_credit_sources" ADD CONSTRAINT "core_payg_credit_sources_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_enrollments" ADD CONSTRAINT "core_payg_enrollments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_enrollments" ADD CONSTRAINT "core_payg_enrollments_offer_version_id_core_payg_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."core_payg_offer_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_invoice_sources" ADD CONSTRAINT "core_payg_invoice_sources_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_invoice_sources" ADD CONSTRAINT "core_payg_invoice_sources_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_invoice_sources" ADD CONSTRAINT "core_payg_invoice_sources_effect_key_core_payg_pending_invoice_effects_idempotency_key_fk" FOREIGN KEY ("effect_key") REFERENCES "public"."core_payg_pending_invoice_effects"("idempotency_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_pending_invoice_effects" ADD CONSTRAINT "core_payg_pending_invoice_effects_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_period_revisions" ADD CONSTRAINT "core_payg_period_revisions_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_source_measurements" ADD CONSTRAINT "core_payg_source_measurements_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_payg_source_receipts" ADD CONSTRAINT "core_payg_source_receipts_enrollment_id_core_payg_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."core_payg_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_claims" ADD CONSTRAINT "core_trial_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_claims" ADD CONSTRAINT "core_trial_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_claims" ADD CONSTRAINT "core_trial_claims_offer_version_id_core_payg_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."core_payg_offer_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_counter_receipts" ADD CONSTRAINT "core_trial_counter_receipts_trial_id_core_trial_claims_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."core_trial_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_reservation_settlements" ADD CONSTRAINT "core_trial_reservation_settlements_reservation_id_core_trial_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."core_trial_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_reservation_settlements" ADD CONSTRAINT "core_trial_reservation_settlements_receipt_id_core_trial_counter_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."core_trial_counter_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_reservations" ADD CONSTRAINT "core_trial_reservations_trial_id_core_trial_claims_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."core_trial_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_trial_reservations" ADD CONSTRAINT "core_trial_reservations_counter_receipt_id_core_trial_counter_receipts_id_fk" FOREIGN KEY ("counter_receipt_id") REFERENCES "public"."core_trial_counter_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_capability_requests" ADD CONSTRAINT "system_capability_requests_capability_key_system_capabilities_capability_key_fk" FOREIGN KEY ("capability_key") REFERENCES "public"."system_capabilities"("capability_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_capability_requests" ADD CONSTRAINT "system_capability_requests_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_capability_requests" ADD CONSTRAINT "system_capability_requests_decided_by_commerce_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_production_bootstraps" ADD CONSTRAINT "system_production_bootstraps_applied_by_commerce_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_provider_connection_references" ADD CONSTRAINT "system_provider_connection_references_updated_by_commerce_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "core_price_schedule_approval_unique" ON "core_price_book_schedules" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_price_schedule_pending_currency_unique" ON "core_price_book_schedules" USING btree ("currency") WHERE "core_price_book_schedules"."status"='approved';--> statement-breakpoint
CREATE UNIQUE INDEX "core_channel_policy_version_unique" ON "core_channel_policy_versions" USING btree ((("terms"->>'version')::integer));--> statement-breakpoint
CREATE UNIQUE INDEX "core_channel_policy_effective_unique" ON "core_channel_policy_versions" USING btree (("terms"->>'effectiveFrom')) WHERE "core_channel_policy_versions"."status"='approved';--> statement-breakpoint
CREATE UNIQUE INDEX "core_payg_offer_version_unique" ON "core_payg_offer_versions" USING btree ("sku","region","version");--> statement-breakpoint
CREATE UNIQUE INDEX "core_payg_credit_effect_allocation_unique" ON "core_payg_credit_sources" USING btree ("effect_key","allocation_index");--> statement-breakpoint
CREATE UNIQUE INDEX "core_payg_enrollment_source_unique" ON "core_payg_enrollments" USING btree ("source","source_entitlement_id");--> statement-breakpoint
CREATE INDEX "core_payg_source_period_idx" ON "core_payg_source_measurements" USING btree ("enrollment_id","starts_at");--> statement-breakpoint
CREATE INDEX "core_payg_receipt_period_idx" ON "core_payg_source_receipts" USING btree ("enrollment_id","closed_through");--> statement-breakpoint
CREATE UNIQUE INDEX "system_capability_requests_pending_unique" ON "system_capability_requests" USING btree ("capability_key") WHERE "system_capability_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "system_provider_connection_references_provider_unique" ON "system_provider_connection_references" USING btree ("provider");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payg_effect_key_unique" UNIQUE("payg_effect_key");