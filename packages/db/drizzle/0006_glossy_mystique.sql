CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"alert_kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"template" text NOT NULL,
	"recipients" text[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"failure_code" text,
	"requested_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_deliveries"."channel" = 'email'),
	CONSTRAINT "notification_delivery_alert_kind_check" CHECK ("notification_deliveries"."alert_kind" in ('renewal_term_window','renewal_notice_window','poc_milestone','quote_expiry','collections_dunning')),
	CONSTRAINT "notification_delivery_subject_check" CHECK ("notification_deliveries"."subject_type" in ('order','poc','quote','invoice')),
	CONSTRAINT "notification_delivery_outcome_check" CHECK (("notification_deliveries"."status" = 'sent' and "notification_deliveries"."provider_message_id" is not null and "notification_deliveries"."delivered_at" is not null and "notification_deliveries"."failure_code" is null) or ("notification_deliveries"."status" = 'failed' and "notification_deliveries"."provider_message_id" is null and "notification_deliveries"."delivered_at" is null and "notification_deliveries"."failure_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "core_commitment_allowance_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"period_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"quantity_delta" numeric(38, 18) NOT NULL,
	"reason" text NOT NULL,
	"source_reference" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_commitment_allowance_adjustment_reason_check" CHECK ("core_commitment_allowance_adjustments"."reason" in ('amendment','renewal','correction'))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "ledger_kind" text DEFAULT 'usage' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "corrects_usage_event_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_allowance_adjustments" ADD CONSTRAINT "core_commitment_allowance_adjustments_ledger_id_commitment_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."commitment_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_allowance_adjustments" ADD CONSTRAINT "core_commitment_allowance_adjustments_period_id_core_commitment_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."core_commitment_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_commitment_allowance_adjustments" ADD CONSTRAINT "core_commitment_allowance_adjustments_recorded_by_commerce_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_idempotency_unique" ON "notification_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_delivery_subject_idx" ON "notification_deliveries" USING btree ("subject_type","subject_id","requested_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_account_idx" ON "notification_deliveries" USING btree ("account_id","alert_kind","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_commitment_allowance_adjustment_source_unique" ON "core_commitment_allowance_adjustments" USING btree ("ledger_id","source_reference");--> statement-breakpoint
CREATE INDEX "core_commitment_allowance_adjustment_replay_idx" ON "core_commitment_allowance_adjustments" USING btree ("ledger_id","effective_at","id");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_corrects_usage_event_id_usage_events_id_fk" FOREIGN KEY ("corrects_usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_ledger_kind_check" CHECK ("usage_events"."ledger_kind" in ('usage','correction'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_correction_target_check" CHECK (("usage_events"."ledger_kind" = 'correction') = ("usage_events"."corrects_usage_event_id" is not null));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_usage_sign_check" CHECK ("usage_events"."ledger_kind" = 'correction' or "usage_events"."quantity" >= 0);