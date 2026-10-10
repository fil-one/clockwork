CREATE TABLE "commerce_pricing_scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_name" text NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"as_of" date NOT NULL,
	"price_books" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "commerce_pricing_scenarios_owner_updated" ON "commerce_pricing_scenarios" USING btree ("owner_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "commerce_pricing_scenarios_updated" ON "commerce_pricing_scenarios" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);