CREATE TABLE "experience_mfa_attempts" (
	"workos_user_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "experience_mfa_attempts_attempts_check" CHECK ("experience_mfa_attempts"."attempts" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "experience_mfa_receipts" (
	"challenge_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"workos_user_id" text NOT NULL,
	"workos_organization_id" text NOT NULL,
	"factor_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '8 hours' NOT NULL,
	CONSTRAINT "experience_mfa_receipt_window_check" CHECK ("experience_mfa_receipts"."expires_at" > "experience_mfa_receipts"."verified_at" and "experience_mfa_receipts"."expires_at" <= "experience_mfa_receipts"."verified_at" + interval '8 hours')
);
--> statement-breakpoint
CREATE INDEX "experience_mfa_receipt_session_idx" ON "experience_mfa_receipts" USING btree ("session_id","workos_user_id","workos_organization_id","verified_at" DESC NULLS LAST);