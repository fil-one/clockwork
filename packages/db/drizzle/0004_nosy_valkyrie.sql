-- Drizzle snapshots cannot model database functions. This definition precedes
-- every generated UUIDv7 default; canonical role grants remain in the
-- forward-only Supabase migration, which is the deployment source of truth.
create or replace function public.uuid_v7() returns uuid
language plpgsql volatile
set search_path = pg_catalog, extensions
as $$
declare
	observed_at timestamptz := clock_timestamp();
	unix_millis bigint;
	sub_millisecond integer;
	entropy bytea := extensions.gen_random_bytes(10);
	entropy_hex text;
	compact text;
begin
	unix_millis := floor(extract(epoch from observed_at) * 1000);
	if unix_millis < 0 or unix_millis >= 281474976710656 then
		raise exception 'UUIDv7 timestamp is outside its 48-bit range';
	end if;
	sub_millisecond := floor(
		((extract(microseconds from observed_at)::bigint % 1000) * 4096) / 1000.0
	);
	entropy_hex := encode(entropy, 'hex');
	compact := lpad(to_hex(unix_millis), 12, '0')
		|| '7'
		|| lpad(to_hex(sub_millisecond), 3, '0')
		|| substring('89ab' from (((get_byte(entropy, 0) >> 6) % 4) + 1) for 1)
		|| substring(entropy_hex from 2 for 15);
	return (
		substring(compact from 1 for 8) || '-'
		|| substring(compact from 9 for 4) || '-'
		|| substring(compact from 13 for 4) || '-'
		|| substring(compact from 17 for 4) || '-'
		|| substring(compact from 21 for 12)
	)::uuid;
end
$$;
--> statement-breakpoint
CREATE TABLE "core_invoice_document_snapshots" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"line_items" jsonb NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"source_hash" text NOT NULL,
	"source_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_invoice_document_snapshot_currency_check" CHECK ("core_invoice_document_snapshots"."currency" in ('USD','EUR','GBP')),
	CONSTRAINT "core_invoice_document_snapshot_lines_check" CHECK (jsonb_typeof("core_invoice_document_snapshots"."line_items") = 'array' and jsonb_array_length("core_invoice_document_snapshots"."line_items") > 0),
	CONSTRAINT "core_invoice_document_snapshot_amounts_check" CHECK ("core_invoice_document_snapshots"."subtotal_minor" >= 0 and "core_invoice_document_snapshots"."tax_minor" >= 0 and "core_invoice_document_snapshots"."total_minor" = "core_invoice_document_snapshots"."subtotal_minor" + "core_invoice_document_snapshots"."tax_minor"),
	CONSTRAINT "core_invoice_document_snapshot_hash_check" CHECK ("core_invoice_document_snapshots"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "core_invoice_document_snapshot_version_check" CHECK (length("core_invoice_document_snapshots"."source_version") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "core_partner_qbo_vendor_mappings" (
	"partner_account_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'qbo' NOT NULL,
	"realm_reference_hash" text NOT NULL,
	"vendor_id" text NOT NULL,
	"verification_status" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"verified_by" uuid NOT NULL,
	"source_reference" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_partner_qbo_vendor_provider_check" CHECK ("core_partner_qbo_vendor_mappings"."provider" = 'qbo'),
	CONSTRAINT "core_partner_qbo_vendor_realm_hash_check" CHECK ("core_partner_qbo_vendor_mappings"."realm_reference_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "core_partner_qbo_vendor_status_check" CHECK ("core_partner_qbo_vendor_mappings"."verification_status" in ('verified','revoked'))
);
--> statement-breakpoint
CREATE TABLE "core_stripe_adjustment_operations" (
	"adjustment_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_currency" text NOT NULL,
	"provider_invoice_id" text,
	"provider_payment_intent_id" text,
	"amount_minor" bigint NOT NULL,
	"individual_cap_minor" bigint NOT NULL,
	"aggregate_cap_minor" bigint NOT NULL,
	"provider_reason" text NOT NULL,
	"internal_reason_code" text NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"state" text DEFAULT 'approved' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"provider_object_id" text,
	"provider_status" text,
	"last_error_code" text,
	"command_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_stripe_adjustment_operations_provider_idempotency_key_unique" UNIQUE("provider_idempotency_key"),
	CONSTRAINT "core_stripe_adjustment_operations_provider_object_id_unique" UNIQUE("provider_object_id"),
	CONSTRAINT "core_stripe_adjustment_kind_check" CHECK ("core_stripe_adjustment_operations"."kind" in ('credit_note','refund')),
	CONSTRAINT "core_stripe_adjustment_state_check" CHECK ("core_stripe_adjustment_operations"."state" in ('approved','submitting','retrying','provider_accepted','rejected')),
	CONSTRAINT "core_stripe_adjustment_amount_check" CHECK ("core_stripe_adjustment_operations"."amount_minor" > 0 and "core_stripe_adjustment_operations"."amount_minor" <= "core_stripe_adjustment_operations"."individual_cap_minor" and "core_stripe_adjustment_operations"."individual_cap_minor" <= "core_stripe_adjustment_operations"."aggregate_cap_minor")
);
--> statement-breakpoint
CREATE TABLE "experience_artifact_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"render_request_id" uuid NOT NULL,
	"account_id" uuid,
	"audience" text NOT NULL,
	"audience_account_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"immutable_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"storage_version_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"filename" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_artifact_deliveries_render_request_id_unique" UNIQUE("render_request_id"),
	CONSTRAINT "experience_artifact_deliveries_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "experience_artifact_deliveries_audience_check" CHECK ("experience_artifact_deliveries"."audience" in ('customer','partner','internal')),
	CONSTRAINT "experience_artifact_deliveries_document_kind_check" CHECK ("experience_artifact_deliveries"."document_kind" in ('direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment','poc_summary','poc_final_report','invoice_companion','receipt','commission_statement','renewal_confirmation','decline_confirmation','deletion_certificate','reconciliation_report','report_export')),
	CONSTRAINT "experience_artifact_deliveries_immutable_version_check" CHECK (length("experience_artifact_deliveries"."immutable_version") between 1 and 80),
	CONSTRAINT "experience_artifact_deliveries_source_hash_check" CHECK ("experience_artifact_deliveries"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_artifact_deliveries_content_hash_check" CHECK ("experience_artifact_deliveries"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_artifact_deliveries_mime_type_check" CHECK ("experience_artifact_deliveries"."mime_type" = 'application/pdf'),
	CONSTRAINT "experience_artifact_deliveries_byte_length_check" CHECK ("experience_artifact_deliveries"."byte_length" > 0),
	CONSTRAINT "experience_artifact_deliveries_filename_check" CHECK ("experience_artifact_deliveries"."filename" ~ '^[a-z0-9][a-z0-9._-]{0,159}\.pdf$' and "experience_artifact_deliveries"."filename" !~ '\.\.'),
	CONSTRAINT "experience_delivery_audience_check" CHECK (("experience_artifact_deliveries"."audience" = 'internal' and "experience_artifact_deliveries"."account_id" is null and "experience_artifact_deliveries"."audience_account_id" is null) or ("experience_artifact_deliveries"."audience" <> 'internal' and "experience_artifact_deliveries"."account_id" is not null and "experience_artifact_deliveries"."audience_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "experience_assisted_sessions" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"authentication_session_id" text NOT NULL,
	"internal_user_id" uuid NOT NULL,
	"actor_snapshot_name" text NOT NULL,
	"actor_snapshot_email" text NOT NULL,
	"target_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_assisted_sessions_actor_snapshot_name_check" CHECK (char_length(trim("experience_assisted_sessions"."actor_snapshot_name")) > 0),
	CONSTRAINT "experience_assisted_sessions_actor_snapshot_email_check" CHECK ("experience_assisted_sessions"."actor_snapshot_email" = lower(trim("experience_assisted_sessions"."actor_snapshot_email"))),
	CONSTRAINT "experience_assisted_sessions_reason_check" CHECK (char_length(trim("experience_assisted_sessions"."reason")) between 8 and 500),
	CONSTRAINT "experience_assisted_session_window_check" CHECK ("experience_assisted_sessions"."expires_at" > "experience_assisted_sessions"."started_at" and "experience_assisted_sessions"."expires_at" <= "experience_assisted_sessions"."started_at" + interval '15 minutes'),
	CONSTRAINT "experience_assisted_session_end_check" CHECK ("experience_assisted_sessions"."ended_at" is null or "experience_assisted_sessions"."ended_at" >= "experience_assisted_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "experience_document_render_requests" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"account_id" uuid,
	"audience" text NOT NULL,
	"audience_account_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"source_version" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "experience_render_source_unique" UNIQUE("subject_type","subject_id","document_kind","source_hash"),
	CONSTRAINT "experience_document_render_requests_audience_check" CHECK ("experience_document_render_requests"."audience" in ('customer','partner','internal')),
	CONSTRAINT "experience_document_render_requests_subject_type_check" CHECK (length("experience_document_render_requests"."subject_type") between 1 and 80),
	CONSTRAINT "experience_document_render_requests_document_kind_check" CHECK ("experience_document_render_requests"."document_kind" in ('direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment','poc_summary','poc_final_report','invoice_companion','receipt','commission_statement','renewal_confirmation','decline_confirmation','deletion_certificate','reconciliation_report','report_export')),
	CONSTRAINT "experience_document_render_requests_input_check" CHECK (jsonb_typeof("experience_document_render_requests"."input") = 'object'),
	CONSTRAINT "experience_document_render_requests_source_hash_check" CHECK ("experience_document_render_requests"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_document_render_requests_source_version_check" CHECK (length("experience_document_render_requests"."source_version") between 1 and 80),
	CONSTRAINT "experience_document_render_requests_status_check" CHECK ("experience_document_render_requests"."status" in ('pending','rendering','stored','failed')),
	CONSTRAINT "experience_document_render_requests_row_version_check" CHECK ("experience_document_render_requests"."row_version" > 0),
	CONSTRAINT "experience_render_audience_check" CHECK (("experience_document_render_requests"."audience" = 'internal' and "experience_document_render_requests"."account_id" is null and "experience_document_render_requests"."audience_account_id" is null) or ("experience_document_render_requests"."audience" <> 'internal' and "experience_document_render_requests"."account_id" is not null and "experience_document_render_requests"."audience_account_id" is not null)),
	CONSTRAINT "experience_render_retention_check" CHECK ("experience_document_render_requests"."retain_until" > "experience_document_render_requests"."created_at")
);
--> statement-breakpoint
CREATE TABLE "experience_esign_return_correlations" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"state_hash" text NOT NULL,
	"envelope_id" uuid NOT NULL,
	"agreement_draft_id" uuid NOT NULL,
	"account_id" uuid,
	"signer_user_id" uuid NOT NULL,
	"signer_email" text NOT NULL,
	"document_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_esign_return_correlations_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "experience_esign_return_correlations_envelope_id_unique" UNIQUE("envelope_id"),
	CONSTRAINT "experience_esign_return_correlations_state_hash_check" CHECK ("experience_esign_return_correlations"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_esign_return_correlations_signer_email_check" CHECK ("experience_esign_return_correlations"."signer_email" = lower("experience_esign_return_correlations"."signer_email")),
	CONSTRAINT "experience_esign_return_expiry_check" CHECK ("experience_esign_return_correlations"."expires_at" > "experience_esign_return_correlations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "experience_esign_return_receipts" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"observed_envelope_state" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	CONSTRAINT "experience_esign_receipt_request_unique" UNIQUE("correlation_id","request_id"),
	CONSTRAINT "experience_esign_return_receipts_request_id_check" CHECK (length("experience_esign_return_receipts"."request_id") between 8 and 128)
);
--> statement-breakpoint
CREATE TABLE "experience_evidence_uploads" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"public_upload_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_upload_id" text,
	"owner_user_id" uuid NOT NULL,
	"account_id" uuid,
	"organization_id" uuid,
	"journey" text NOT NULL,
	"target_id" uuid NOT NULL,
	"evidence_kind" text NOT NULL,
	"declared_content_hash" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_byte_length" bigint NOT NULL,
	"quarantine_storage_key" text,
	"immutable_storage_key" text,
	"storage_version_id" text,
	"scan_reference" text,
	"document_id" uuid,
	"retain_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "experience_evidence_uploads_public_upload_id_unique" UNIQUE("public_upload_id"),
	CONSTRAINT "experience_evidence_uploads_provider_upload_id_unique" UNIQUE("provider_upload_id"),
	CONSTRAINT "experience_evidence_idempotency_unique" UNIQUE("owner_user_id","idempotency_key"),
	CONSTRAINT "experience_evidence_uploads_public_upload_id_check" CHECK ("experience_evidence_uploads"."public_upload_id" ~ '^upl_[A-Za-z0-9_-]{20,80}$'),
	CONSTRAINT "experience_evidence_uploads_idempotency_key_check" CHECK (length("experience_evidence_uploads"."idempotency_key") between 16 and 255),
	CONSTRAINT "experience_evidence_uploads_journey_check" CHECK ("experience_evidence_uploads"."journey" in ('customer_paper','poc','procurement','exception','approval')),
	CONSTRAINT "experience_evidence_uploads_evidence_kind_check" CHECK ("experience_evidence_uploads"."evidence_kind" in ('agreement','acceptance','quote','order_form','amendment','notice','completion_certificate','deletion_certificate','screening','approval')),
	CONSTRAINT "experience_evidence_uploads_declared_content_hash_check" CHECK ("experience_evidence_uploads"."declared_content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_evidence_uploads_declared_mime_type_check" CHECK ("experience_evidence_uploads"."declared_mime_type" in ('application/pdf','image/png','image/jpeg','text/plain','text/csv')),
	CONSTRAINT "experience_evidence_uploads_declared_byte_length_check" CHECK ("experience_evidence_uploads"."declared_byte_length" between 1 and 52428800),
	CONSTRAINT "experience_evidence_uploads_status_check" CHECK ("experience_evidence_uploads"."status" in ('pending','uploaded','scanning','quarantined','promoted','expired','failed')),
	CONSTRAINT "experience_evidence_uploads_row_version_check" CHECK ("experience_evidence_uploads"."row_version" > 0),
	CONSTRAINT "experience_evidence_expiry_retention_check" CHECK ("experience_evidence_uploads"."expires_at" > "experience_evidence_uploads"."created_at" and "experience_evidence_uploads"."retain_until" > "experience_evidence_uploads"."expires_at"),
	CONSTRAINT "experience_evidence_scope_check" CHECK ("experience_evidence_uploads"."account_id" is not null),
	CONSTRAINT "experience_evidence_state_metadata_check" CHECK (("experience_evidence_uploads"."status" = 'pending' and "experience_evidence_uploads"."provider_upload_id" is null and "experience_evidence_uploads"."document_id" is null) or ("experience_evidence_uploads"."status" in ('uploaded','scanning') and "experience_evidence_uploads"."provider_upload_id" is not null and "experience_evidence_uploads"."document_id" is null) or ("experience_evidence_uploads"."status" = 'quarantined' and "experience_evidence_uploads"."scan_reference" is not null and "experience_evidence_uploads"."document_id" is null) or ("experience_evidence_uploads"."status" = 'promoted' and "experience_evidence_uploads"."provider_upload_id" is not null and "experience_evidence_uploads"."immutable_storage_key" is not null and "experience_evidence_uploads"."storage_version_id" is not null and "experience_evidence_uploads"."scan_reference" is not null and "experience_evidence_uploads"."document_id" is not null and "experience_evidence_uploads"."failure_code" is null) or ("experience_evidence_uploads"."status" in ('expired','failed') and "experience_evidence_uploads"."document_id" is null))
);
--> statement-breakpoint
CREATE TABLE "experience_portal_projections" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"audience" text NOT NULL,
	"audience_account_id" uuid,
	"subject_account_id" uuid,
	"channel" text NOT NULL,
	"record_key" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"command_resource" text,
	"payload" jsonb NOT NULL,
	"source_aggregate_version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "experience_projection_identity_unique" UNIQUE NULLS NOT DISTINCT("audience","audience_account_id","channel","record_key"),
	CONSTRAINT "experience_portal_projections_audience_check" CHECK ("experience_portal_projections"."audience" in ('customer','partner','internal')),
	CONSTRAINT "experience_portal_projections_channel_check" CHECK ("experience_portal_projections"."channel" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "experience_portal_projections_record_key_check" CHECK (length("experience_portal_projections"."record_key") between 1 and 160),
	CONSTRAINT "experience_portal_projections_aggregate_type_check" CHECK (length("experience_portal_projections"."aggregate_type") between 1 and 80),
	CONSTRAINT "experience_portal_projections_source_hash_check" CHECK ("experience_portal_projections"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_projection_source_aggregate_version_check" CHECK ("experience_portal_projections"."source_aggregate_version" > 0),
	CONSTRAINT "experience_portal_projections_row_version_check" CHECK ("experience_portal_projections"."row_version" > 0),
	CONSTRAINT "experience_projection_audience_scope_check" CHECK (("experience_portal_projections"."audience" = 'internal' and "experience_portal_projections"."audience_account_id" is null) or ("experience_portal_projections"."audience" <> 'internal' and "experience_portal_projections"."audience_account_id" is not null)),
	CONSTRAINT "experience_projection_payload_check" CHECK (jsonb_typeof("experience_portal_projections"."payload") = 'object' and (not ("experience_portal_projections"."payload" ? 'allowedActions') or jsonb_typeof("experience_portal_projections"."payload"->'allowedActions') = 'array'))
);
--> statement-breakpoint
CREATE TABLE "experience_projection_action_claims" (
	"action_request_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "experience_action_claim_event_unique" UNIQUE("event_id"),
	CONSTRAINT "experience_action_claim_message_unique" UNIQUE("message_id"),
	CONSTRAINT "experience_projection_action_claims_idempotency_key_check" CHECK (length("experience_projection_action_claims"."idempotency_key") between 16 and 255),
	CONSTRAINT "experience_action_claim_lease_check" CHECK (("experience_projection_action_claims"."claim_token" is null and "experience_projection_action_claims"."lease_until" is null) or ("experience_projection_action_claims"."claim_token" is not null and "experience_projection_action_claims"."lease_until" is not null)),
	CONSTRAINT "experience_projection_action_claims_attempt_count_check" CHECK ("experience_projection_action_claims"."attempt_count" >= 0),
	CONSTRAINT "experience_projection_action_claims_row_version_check" CHECK ("experience_projection_action_claims"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "experience_projection_action_requests" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"projection_id" uuid NOT NULL,
	"audience_account_id" uuid,
	"subject_account_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"command_resource" text NOT NULL,
	"action" text NOT NULL,
	"expected_version" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"effective_account_id" uuid,
	"assisted_session_id" uuid,
	"assisted_reason" text,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"recent_authentication_verified" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result_reference" text,
	"result_code" text,
	"authoritative_version" integer,
	"command_replayed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"audit_event_id" uuid DEFAULT public.uuid_v7() NOT NULL,
	"outbox_message_id" uuid DEFAULT public.uuid_v7() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "experience_projection_action_requests_audit_event_id_unique" UNIQUE("audit_event_id"),
	CONSTRAINT "experience_projection_action_requests_outbox_message_id_unique" UNIQUE("outbox_message_id"),
	CONSTRAINT "experience_action_idempotency_unique" UNIQUE("actor_user_id","idempotency_key"),
	CONSTRAINT "experience_projection_action_requests_action_check" CHECK ("experience_projection_action_requests"."action" ~ '^[a-z][a-z0-9_]{1,79}$'),
	CONSTRAINT "experience_projection_action_requests_expected_version_check" CHECK ("experience_projection_action_requests"."expected_version" > 0),
	CONSTRAINT "experience_projection_action_requests_idempotency_key_check" CHECK (length("experience_projection_action_requests"."idempotency_key") between 16 and 255),
	CONSTRAINT "experience_projection_action_requests_request_payload_check" CHECK (jsonb_typeof("experience_projection_action_requests"."request_payload") = 'object'),
	CONSTRAINT "experience_projection_action_requests_status_check" CHECK ("experience_projection_action_requests"."status" in ('queued','applied','rejected','failed')),
	CONSTRAINT "experience_action_completion_check" CHECK (("experience_projection_action_requests"."status" = 'queued' and "experience_projection_action_requests"."completed_at" is null and "experience_projection_action_requests"."result_reference" is null and "experience_projection_action_requests"."result_code" is null and "experience_projection_action_requests"."authoritative_version" is null and "experience_projection_action_requests"."command_replayed" is null) or ("experience_projection_action_requests"."status" <> 'queued' and "experience_projection_action_requests"."completed_at" is not null and "experience_projection_action_requests"."result_reference" is not null and "experience_projection_action_requests"."result_code" is not null and ("experience_projection_action_requests"."command_replayed" is not null or ("experience_projection_action_requests"."status" = 'applied' and "experience_projection_action_requests"."result_code" = 'LEGACY_PORTAL_ACTION_APPLIED') or ("experience_projection_action_requests"."status" = 'rejected' and "experience_projection_action_requests"."result_code" = 'LEGACY_PORTAL_ACTION_REJECTED') or ("experience_projection_action_requests"."status" = 'failed' and "experience_projection_action_requests"."result_code" in ('LEGACY_PORTAL_ACTION_FAILED','LEGACY_PROJECTION_VERSION_UNVERIFIED'))) and ("experience_projection_action_requests"."authoritative_version" is null or "experience_projection_action_requests"."authoritative_version" > 0))),
	CONSTRAINT "experience_action_assisted_check" CHECK (("experience_projection_action_requests"."assisted_session_id" is null and "experience_projection_action_requests"."assisted_reason" is null) or ("experience_projection_action_requests"."assisted_session_id" is not null and "experience_projection_action_requests"."effective_account_id" is not null and length(trim("experience_projection_action_requests"."assisted_reason")) >= 8)),
	CONSTRAINT "experience_projection_action_requests_row_version_check" CHECK ("experience_projection_action_requests"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "experience_projection_materialization_receipts" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"source_hash" text NOT NULL,
	"projection_count" integer NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experience_projection_materialization_receipts_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "experience_projection_receipt_source_unique" UNIQUE("aggregate_type","aggregate_id","aggregate_version","event_type"),
	CONSTRAINT "experience_projection_materialization_aggregate_type_check" CHECK (length("experience_projection_materialization_receipts"."aggregate_type") between 1 and 80),
	CONSTRAINT "experience_projection_materialization_aggregate_version_check" CHECK ("experience_projection_materialization_receipts"."aggregate_version" > 0),
	CONSTRAINT "experience_projection_materialization_event_type_check" CHECK (length("experience_projection_materialization_receipts"."event_type") between 3 and 160),
	CONSTRAINT "experience_projection_materialization_projection_count_check" CHECK ("experience_projection_materialization_receipts"."projection_count" >= 0),
	CONSTRAINT "experience_projection_materialization_source_hash_check" CHECK ("experience_projection_materialization_receipts"."source_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "experience_release_proof_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"recent_authentication_verified" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_release_proof_session_unique" UNIQUE("id","user_id","organization_id"),
	CONSTRAINT "experience_release_proof_sessions_nonce_hash_check" CHECK ("experience_release_proof_sessions"."nonce_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "system_capabilities" (
	"capability_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"recovery_enabled" boolean DEFAULT false NOT NULL,
	"change_reason" text NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "system_capabilities_key_check" CHECK ("system_capabilities"."capability_key" in ('new_business','legal','billing','partner','marketplace','teardown'))
);
--> statement-breakpoint
CREATE TABLE "system_exception_roster" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"qualification_evidence_reference" text NOT NULL,
	"qualified_until" timestamp with time zone NOT NULL,
	"absent_from" timestamp with time zone,
	"absent_until" timestamp with time zone,
	"target_minutes" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "system_exception_roster_queue_check" CHECK ("system_exception_roster"."queue" ~ '^[a-z][a-z0-9_]{1,63}$'),
	CONSTRAINT "system_exception_roster_role_check" CHECK ("system_exception_roster"."role" in ('primary','backup','escalation')),
	CONSTRAINT "system_exception_roster_target_check" CHECK ("system_exception_roster"."target_minutes" between 1 and 43200),
	CONSTRAINT "system_exception_roster_priority_check" CHECK ("system_exception_roster"."priority" between 0 and 1000000),
	CONSTRAINT "system_exception_roster_qualification_evidence_check" CHECK (length(trim("system_exception_roster"."qualification_evidence_reference")) > 0),
	CONSTRAINT "system_exception_roster_absence_check" CHECK (("system_exception_roster"."absent_from" is null and "system_exception_roster"."absent_until" is null) or ("system_exception_roster"."absent_from" is not null and "system_exception_roster"."absent_until" is not null and "system_exception_roster"."absent_from" < "system_exception_roster"."absent_until"))
);
--> statement-breakpoint
CREATE TABLE "system_external_gate_activation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"task_key" text NOT NULL,
	"gate_key" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"probe_result" jsonb,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "system_external_gate_activation_tasks_task_key_unique" UNIQUE("task_key"),
	CONSTRAINT "system_gate_activation_mode_check" CHECK ("system_external_gate_activation_tasks"."mode" in ('live','simulator')),
	CONSTRAINT "system_gate_activation_task_key_check" CHECK (length(trim("system_external_gate_activation_tasks"."task_key")) >= 8),
	CONSTRAINT "system_gate_activation_provider_check" CHECK (length(trim("system_external_gate_activation_tasks"."provider")) > 0),
	CONSTRAINT "system_gate_activation_status_check" CHECK ("system_external_gate_activation_tasks"."status" in ('pending','probing','provider_succeeded','succeeded','retrying','dead_letter')),
	CONSTRAINT "system_gate_activation_attempt_check" CHECK ("system_external_gate_activation_tasks"."attempt_count" >= 0),
	CONSTRAINT "system_gate_activation_result_check" CHECK ("system_external_gate_activation_tasks"."status" not in ('provider_succeeded','succeeded') or "system_external_gate_activation_tasks"."probe_result" is not null),
	CONSTRAINT "system_gate_activation_completed_check" CHECK (("system_external_gate_activation_tasks"."status" = 'succeeded' and "system_external_gate_activation_tasks"."completed_at" is not null) or ("system_external_gate_activation_tasks"."status" <> 'succeeded' and "system_external_gate_activation_tasks"."completed_at" is null)),
	CONSTRAINT "system_gate_activation_lease_check" CHECK (("system_external_gate_activation_tasks"."status" in ('probing','provider_succeeded') and "system_external_gate_activation_tasks"."lease_token" is not null and "system_external_gate_activation_tasks"."lease_until" is not null) or ("system_external_gate_activation_tasks"."status" not in ('probing','provider_succeeded') and "system_external_gate_activation_tasks"."lease_token" is null and "system_external_gate_activation_tasks"."lease_until" is null))
);
--> statement-breakpoint
ALTER TABLE "commission_accruals" DROP CONSTRAINT "commission_accruals_source_type_check";--> statement-breakpoint
ALTER TABLE "commission_accruals" DROP CONSTRAINT "commission_accruals_sign_check";--> statement-breakpoint
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_status_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_status_check";--> statement-breakpoint
ALTER TABLE "core_commission_statement_lines" DROP CONSTRAINT "core_commission_statement_line_source_check";--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" DROP CONSTRAINT "core_order_agreement_version_check";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "agreement_templates" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "agreements" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "amendment_lines" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "amendments" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "commerce_users" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "commission_accruals" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "commitment_entries" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "commitment_ledgers" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "cost_records" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "stripe_credit_note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_registrations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "deletion_certificates" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "dispute_cases" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "exception_cases" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "idempotency_records" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "inbound_notices" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "key_terms" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "novations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "order_lines" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "outbox_messages" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "pocs" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "price_books" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "procurement_profiles" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "provider_operations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "rate_cards" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "stripe_refund_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_exports" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "role_sync_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "terminations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commercial_artifact_requests" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_account_contacts" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_account_tax_identifiers" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_accounting_export_entries" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_accounting_exports" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_amendment_line_supersessions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_collection_actions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_collection_cases" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commission_settlement_exports" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commission_statement_lines" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commission_statements" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commitment_ledger_corrections" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_commitment_periods" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_deal_registration_disputes" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_deal_registration_exclusions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_invoice_end_client_allocations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_marketplace_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_marketplace_financial_entries" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_marketplace_reconciliations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_order_line_snapshots" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_partner_hierarchy_edges" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_partner_transfer_tiers" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_price_book_activation_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_pricing_exception_decisions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_procurement_certificates" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_quote_snapshots" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_three_way_tie_outs" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "core_usage_reconciliations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_agreement_drafts" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_click_acceptances" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_domain_events" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_feature_gate_approvals" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_idempotency_records" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_migration_matches" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_migration_runs" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_partner_domains" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_pass_through_acceptances" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_poc_evidence" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_provisioning_attempts" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_renewal_actions" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "lifecycle_signature_envelopes" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "system_external_gates" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "system_provider_projection_checkpoints" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "system_provider_resource_bindings" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "stripe_last_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "stripe_last_event_id" text;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "requester_user_id" uuid;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "escalation_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "separation_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "ownership_roster_entry_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "ownership_absence_escalated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "stripe_last_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "stripe_last_event_id" text;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD COLUMN "buyer_agreement_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD COLUMN "buyer_agreement_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD COLUMN "partner_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD COLUMN "partner_agreement_version" integer;--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD COLUMN "input_provenance" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD COLUMN "emergency_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD COLUMN "emergency_disabled_by" text;--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD COLUMN "emergency_disable_reason" text;--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD COLUMN "emergency_disable_evidence_reference" text;--> statement-breakpoint
ALTER TABLE "core_invoice_document_snapshots" ADD CONSTRAINT "core_invoice_document_snapshots_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_document_snapshots" ADD CONSTRAINT "core_invoice_document_snapshots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_document_snapshots" ADD CONSTRAINT "core_invoice_document_snapshots_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_partner_qbo_vendor_mappings" ADD CONSTRAINT "core_partner_qbo_vendor_mappings_partner_account_id_accounts_id_fk" FOREIGN KEY ("partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_partner_qbo_vendor_mappings" ADD CONSTRAINT "core_partner_qbo_vendor_mappings_verified_by_commerce_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_stripe_adjustment_operations" ADD CONSTRAINT "core_stripe_adjustment_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_artifact_deliveries" ADD CONSTRAINT "experience_artifact_deliveries_render_request_id_experience_document_render_requests_id_fk" FOREIGN KEY ("render_request_id") REFERENCES "public"."experience_document_render_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_artifact_deliveries" ADD CONSTRAINT "experience_artifact_deliveries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_artifact_deliveries" ADD CONSTRAINT "experience_artifact_deliveries_audience_account_id_accounts_id_fk" FOREIGN KEY ("audience_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_artifact_deliveries" ADD CONSTRAINT "experience_artifact_deliveries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_assisted_sessions" ADD CONSTRAINT "experience_assisted_sessions_internal_user_id_commerce_users_id_fk" FOREIGN KEY ("internal_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_assisted_sessions" ADD CONSTRAINT "experience_assisted_sessions_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_document_render_requests" ADD CONSTRAINT "experience_document_render_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_document_render_requests" ADD CONSTRAINT "experience_document_render_requests_audience_account_id_accounts_id_fk" FOREIGN KEY ("audience_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_document_render_requests" ADD CONSTRAINT "experience_document_render_requests_requested_by_commerce_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ADD CONSTRAINT "experience_esign_return_correlations_envelope_id_lifecycle_signature_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."lifecycle_signature_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ADD CONSTRAINT "experience_esign_return_correlations_agreement_draft_id_lifecycle_agreement_drafts_id_fk" FOREIGN KEY ("agreement_draft_id") REFERENCES "public"."lifecycle_agreement_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ADD CONSTRAINT "experience_esign_return_correlations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ADD CONSTRAINT "experience_esign_return_correlations_signer_user_id_commerce_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ADD CONSTRAINT "experience_esign_return_correlations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_receipts" ADD CONSTRAINT "experience_esign_return_receipts_correlation_id_experience_esign_return_correlations_id_fk" FOREIGN KEY ("correlation_id") REFERENCES "public"."experience_esign_return_correlations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_esign_return_receipts" ADD CONSTRAINT "experience_esign_return_receipts_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_evidence_uploads" ADD CONSTRAINT "experience_evidence_uploads_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_evidence_uploads" ADD CONSTRAINT "experience_evidence_uploads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_evidence_uploads" ADD CONSTRAINT "experience_evidence_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_evidence_uploads" ADD CONSTRAINT "experience_evidence_uploads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_portal_projections" ADD CONSTRAINT "experience_portal_projections_audience_account_id_accounts_id_fk" FOREIGN KEY ("audience_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_portal_projections" ADD CONSTRAINT "experience_portal_projections_subject_account_id_accounts_id_fk" FOREIGN KEY ("subject_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_claims" ADD CONSTRAINT "experience_projection_action_claims_action_request_id_experience_projection_action_requests_id_fk" FOREIGN KEY ("action_request_id") REFERENCES "public"."experience_projection_action_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_claims" ADD CONSTRAINT "experience_projection_action_claims_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_claims" ADD CONSTRAINT "experience_projection_action_claims_message_id_outbox_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_projection_id_experience_portal_projections_id_fk" FOREIGN KEY ("projection_id") REFERENCES "public"."experience_portal_projections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_audience_account_id_accounts_id_fk" FOREIGN KEY ("audience_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_subject_account_id_accounts_id_fk" FOREIGN KEY ("subject_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_effective_account_id_accounts_id_fk" FOREIGN KEY ("effective_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_audit_event_id_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_action_requests" ADD CONSTRAINT "experience_projection_action_requests_outbox_message_id_outbox_messages_id_fk" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_projection_materialization_receipts" ADD CONSTRAINT "experience_projection_materialization_receipts_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_release_proof_sessions" ADD CONSTRAINT "experience_release_proof_sessions_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_release_proof_sessions" ADD CONSTRAINT "experience_release_proof_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_exception_roster" ADD CONSTRAINT "system_exception_roster_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_exception_roster" ADD CONSTRAINT "system_exception_roster_user_id_commerce_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_external_gate_activation_tasks" ADD CONSTRAINT "system_external_gate_activation_tasks_gate_key_system_external_gates_gate_key_fk" FOREIGN KEY ("gate_key") REFERENCES "public"."system_external_gates"("gate_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "core_invoice_document_snapshot_source_unique" ON "core_invoice_document_snapshots" USING btree ("source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "core_partner_qbo_vendor_provider_unique" ON "core_partner_qbo_vendor_mappings" USING btree ("provider","vendor_id");--> statement-breakpoint
CREATE INDEX "core_stripe_adjustment_source_idx" ON "core_stripe_adjustment_operations" USING btree ("kind","source_id","source_currency","state");--> statement-breakpoint
CREATE INDEX "experience_delivery_subject_idx" ON "experience_artifact_deliveries" USING btree ("subject_type","subject_id","document_kind");--> statement-breakpoint
CREATE INDEX "experience_delivery_audience_idx" ON "experience_artifact_deliveries" USING btree ("audience","audience_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "experience_assisted_session_active_idx" ON "experience_assisted_sessions" USING btree ("internal_user_id","authentication_session_id","ended_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "experience_assisted_session_single_live_idx" ON "experience_assisted_sessions" USING btree ("internal_user_id","authentication_session_id") WHERE "experience_assisted_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "experience_esign_receipt_correlation_idx" ON "experience_esign_return_receipts" USING btree ("correlation_id","observed_at");--> statement-breakpoint
CREATE INDEX "experience_evidence_owner_idx" ON "experience_evidence_uploads" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "experience_evidence_pending_idx" ON "experience_evidence_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "experience_projection_page_idx" ON "experience_portal_projections" USING btree ("audience","audience_account_id","channel","source_updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "experience_projection_aggregate_idx" ON "experience_portal_projections" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "experience_projection_action_claim_lease_idx" ON "experience_projection_action_claims" USING btree ("lease_until") WHERE "experience_projection_action_claims"."claim_token" is not null;--> statement-breakpoint
CREATE INDEX "experience_action_dispatch_idx" ON "experience_projection_action_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "experience_release_proof_session_expiry_idx" ON "experience_release_proof_sessions" USING btree ("expires_at","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_exception_roster_assignment_unique" ON "system_exception_roster" USING btree ("account_id","queue","user_id","role");--> statement-breakpoint
CREATE INDEX "system_exception_roster_resolution_idx" ON "system_exception_roster" USING btree ("account_id","queue","active","role","priority");--> statement-breakpoint
CREATE INDEX "system_gate_activation_recovery_idx" ON "system_external_gate_activation_tasks" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "system_gate_activation_gate_idx" ON "system_external_gate_activation_tasks" USING btree ("gate_key","provider","created_at");--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_requester_user_id_commerce_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_escalation_owner_user_id_commerce_users_id_fk" FOREIGN KEY ("escalation_owner_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_buyer_agreement_id_agreements_id_fk" FOREIGN KEY ("buyer_agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_commercial_profiles_partner_agreement_id_agreements_id_fk" FOREIGN KEY ("partner_agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_source_type_check" CHECK ("commission_accruals"."source_type" in ('payment','credit_note','credit_note_void','refund','dispute'));--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_sign_check" CHECK (("commission_accruals"."source_type" = 'payment' and "commission_accruals"."adjustment_source_id" is null and "commission_accruals"."net_collected_revenue_minor" >= 0 and "commission_accruals"."amount_minor" >= 0 and "commission_accruals"."holdback_minor" >= 0) or ("commission_accruals"."source_type" = 'credit_note_void' and "commission_accruals"."adjustment_source_id" is not null and "commission_accruals"."net_collected_revenue_minor" >= 0 and "commission_accruals"."amount_minor" >= 0 and "commission_accruals"."holdback_minor" >= 0) or ("commission_accruals"."source_type" in ('credit_note','refund','dispute') and "commission_accruals"."adjustment_source_id" is not null and "commission_accruals"."net_collected_revenue_minor" <= 0 and "commission_accruals"."amount_minor" <= 0 and "commission_accruals"."holdback_minor" <= 0));--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_stripe_watermark_check" CHECK (("credit_notes"."stripe_last_occurred_at" is null) = ("credit_notes"."stripe_last_event_id" is null));--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_status_check" CHECK ("credit_notes"."status" in ('approved','pending','issued','failed','void'));--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_case_roster_separation_check" CHECK ("exception_cases"."escalation_owner_user_id" is null or ("exception_cases"."escalation_owner_user_id" <> "exception_cases"."owner_user_id" and "exception_cases"."escalation_owner_user_id" is distinct from "exception_cases"."backup_user_id"));--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_success_test_targets_check" CHECK (coalesce(jsonb_typeof("pocs"."success_tests") = 'array', false)
        and jsonb_array_length("pocs"."success_tests") > 0
        and coalesce(
          jsonb_path_exists(
            "pocs"."success_tests",
            '$[*] ? (@.type() != "object" || !exists(@.target) || @.target.type() != "string" || @.target like_regex "^\s*$")'
          ),
          true
        ) = false);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_stripe_watermark_check" CHECK (("refunds"."stripe_last_occurred_at" is null) = ("refunds"."stripe_last_event_id" is null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('approved','pending','succeeded','failed'));--> statement-breakpoint
ALTER TABLE "core_commission_statement_lines" ADD CONSTRAINT "core_commission_statement_line_source_check" CHECK ("core_commission_statement_lines"."source_type" in ('payment','credit_note','credit_note_void','refund','dispute'));--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_partner_agreement_route_check" CHECK (("core_order_commercial_profiles"."billing_shape" in ('referral','resale','distributor')) = ("core_order_commercial_profiles"."partner_agreement_id" is not null));--> statement-breakpoint
ALTER TABLE "core_order_commercial_profiles" ADD CONSTRAINT "core_order_agreement_version_check" CHECK ("core_order_commercial_profiles"."governing_agreement_version" > 0 and "core_order_commercial_profiles"."buyer_agreement_version" > 0 and ("core_order_commercial_profiles"."partner_agreement_id" is null) = ("core_order_commercial_profiles"."partner_agreement_version" is null) and ("core_order_commercial_profiles"."partner_agreement_version" is null or "core_order_commercial_profiles"."partner_agreement_version" > 0));--> statement-breakpoint
ALTER TABLE "lifecycle_offboarding_plans" ADD CONSTRAINT "lifecycle_offboarding_exclusion_reasons_check" CHECK (coalesce(jsonb_typeof("lifecycle_offboarding_plans"."plan"->'lockedExclusions') = 'array', false)
        and coalesce(
          jsonb_path_exists(
            "lifecycle_offboarding_plans"."plan",
            '$.lockedExclusions[*] ? (@.type() != "object" || !exists(@.legalHold) || @.legalHold.type() != "boolean" || !exists(@.reason) || @.reason.type() != "string" || (@.legalHold == true && @.reason != "legal_hold") || (@.legalHold == false && @.reason != "object_lock_retention"))'
          ),
          true
        ) = false);--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD CONSTRAINT "system_external_gates_input_provenance_check" CHECK ("system_external_gates"."input_provenance" in ('unverified','repository_fixture','live_signed'));--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD CONSTRAINT "system_external_gates_signed_input_activation_check" CHECK ("system_external_gates"."configured_status" <> 'active' or "system_external_gates"."gate_key" not in ('EXT-COMMERCIAL-01','EXT-TAX-01') or "system_external_gates"."input_provenance" = 'live_signed');--> statement-breakpoint
ALTER TABLE "system_external_gates" ADD CONSTRAINT "system_external_gates_emergency_state_check" CHECK (("system_external_gates"."emergency_disabled_at" is null and "system_external_gates"."emergency_disabled_by" is null and "system_external_gates"."emergency_disable_reason" is null and "system_external_gates"."emergency_disable_evidence_reference" is null) or ("system_external_gates"."emergency_disabled_at" is not null and "system_external_gates"."emergency_disabled_by" is not null and "system_external_gates"."emergency_disable_reason" is not null and "system_external_gates"."emergency_disable_evidence_reference" is not null and length(trim("system_external_gates"."emergency_disabled_by")) > 0 and length(trim("system_external_gates"."emergency_disable_reason")) >= 8 and length(trim("system_external_gates"."emergency_disable_evidence_reference")) > 0));
