CREATE TABLE "commerce_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"counterparty_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"contract_type" text NOT NULL,
	"paper" text NOT NULL,
	"status" text NOT NULL,
	"effective_date" date,
	"initial_term_months" integer,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_term_months" integer,
	"notice_period_days" integer,
	"value_minor" bigint,
	"currency" text,
	"pricing_notes" text DEFAULT '' NOT NULL,
	"owner_name" text NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text DEFAULT 'register' NOT NULL,
	"executed_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_contract_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_contract_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_backend" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_contract_files_storage_backend_storage_key_unique" UNIQUE("storage_backend","storage_key")
);
--> statement-breakpoint
CREATE TABLE "commerce_contract_signing" (
	"contract_id" uuid PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"template_version" text NOT NULL,
	"template_hash" text NOT NULL,
	"document_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"counterparty_signer" jsonb NOT NULL,
	"countersigner" jsonb NOT NULL,
	"preparer_id" uuid NOT NULL,
	"preparer_name" text NOT NULL,
	"approval_required" boolean NOT NULL,
	"approval_state" text NOT NULL,
	"approver_id" uuid,
	"approver_name" text,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"provider_id" text,
	"test_mode" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commerce_contract_signing_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_sales_collateral" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"status" text NOT NULL,
	"content_updated_on" date NOT NULL,
	"link_url" text,
	"file_name" text,
	"storage_backend" text,
	"storage_key" text,
	"sha256" text,
	"size_bytes" integer,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"updated_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_stored_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce_contract_events" ADD CONSTRAINT "commerce_contract_events_contract_id_commerce_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."commerce_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_contract_files" ADD CONSTRAINT "commerce_contract_files_contract_id_commerce_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."commerce_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_contract_signing" ADD CONSTRAINT "commerce_contract_signing_contract_id_commerce_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."commerce_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_contracts_type_status" ON "commerce_contracts" USING btree ("contract_type","status");--> statement-breakpoint
CREATE INDEX "commerce_contracts_updated" ON "commerce_contracts" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "commerce_contract_events_contract" ON "commerce_contract_events" USING btree ("contract_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commerce_contract_files_contract" ON "commerce_contract_files" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_contract_files_one_generated" ON "commerce_contract_files" USING btree ("contract_id") WHERE "commerce_contract_files"."kind" = 'generated';--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_contract_files_one_executed" ON "commerce_contract_files" USING btree ("contract_id") WHERE "commerce_contract_files"."kind" = 'executed';--> statement-breakpoint
CREATE INDEX "commerce_sales_collateral_listing" ON "commerce_sales_collateral" USING btree ("status","audience","content_updated_on" DESC NULLS LAST);