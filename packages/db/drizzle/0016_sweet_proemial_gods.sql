ALTER TABLE "commerce_mnda_requests" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_contract_signing" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_contract_signing" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_event_type_timeline_idx" ON "audit_events" USING btree ("event_type","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);