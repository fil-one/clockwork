ALTER TABLE "invoices" ADD COLUMN "amount_paid_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_remaining_minor" bigint GENERATED ALWAYS AS (greatest(amount_minor - amount_paid_minor, 0::bigint)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_paid_check" CHECK ("invoices"."amount_paid_minor" >= 0);