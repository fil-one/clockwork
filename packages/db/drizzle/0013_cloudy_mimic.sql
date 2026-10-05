CREATE TABLE "commerce_mnda_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"notice_email" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "notice_email" text;--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "corrected_signer_email" text;--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_mnda_requests" ADD COLUMN "cancel_reason" text;