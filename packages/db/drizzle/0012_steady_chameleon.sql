CREATE TABLE "commerce_mnda_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_mnda_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"input" jsonb NOT NULL,
	"countersigner" jsonb NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_name" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"provider_id" text,
	"template_hash" text NOT NULL,
	"test_mode" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commerce_mnda_requests_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_mnda_signers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commerce_mnda_signers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "commerce_mnda_artifacts" ADD CONSTRAINT "commerce_mnda_artifacts_request_id_commerce_mnda_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."commerce_mnda_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_mnda_artifact_kind" ON "commerce_mnda_artifacts" USING btree ("request_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_mnda_one_default" ON "commerce_mnda_signers" USING btree ("is_default") WHERE "commerce_mnda_signers"."is_default" = true;