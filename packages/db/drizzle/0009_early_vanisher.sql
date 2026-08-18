CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"alert_kind" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_preference_alert_kind_check" CHECK ("notification_preferences"."alert_kind" in ('renewal_term_window','poc_milestone','quote_expiry')),
	CONSTRAINT "notification_preference_channel_check" CHECK ("notification_preferences"."channel" = 'email')
);
--> statement-breakpoint
CREATE TABLE "core_invoice_tax_determinations" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"determination_id" uuid NOT NULL,
	"supplier_legal_entity_id" uuid NOT NULL,
	"supplier_registration_id" uuid,
	"customer_account_id" uuid NOT NULL,
	"customer_registration_id" uuid,
	"customer_status" text NOT NULL,
	"place_of_supply" text[] NOT NULL,
	"tax_point_date" date NOT NULL,
	"currency" text NOT NULL,
	"net_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"treatment" text NOT NULL,
	"confidence" text NOT NULL,
	"review_reasons" text[] DEFAULT '{}' NOT NULL,
	"rounding" text NOT NULL,
	"input_provenance" text NOT NULL,
	"determination_input" jsonb NOT NULL,
	"determination_input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_invoice_tax_determinations_determination_id_key" UNIQUE("determination_id"),
	CONSTRAINT "core_invoice_tax_determinations_customer_status_check" CHECK ("core_invoice_tax_determinations"."customer_status" in ('business','consumer')),
	CONSTRAINT "core_invoice_tax_determinations_place_of_supply_check" CHECK (array_length("core_invoice_tax_determinations"."place_of_supply", 1) >= 1),
	CONSTRAINT "core_invoice_tax_determinations_currency_check" CHECK ("core_invoice_tax_determinations"."currency" in ('USD','EUR','GBP')),
	CONSTRAINT "core_invoice_tax_determinations_net_minor_check" CHECK ("core_invoice_tax_determinations"."net_minor" >= 0),
	CONSTRAINT "core_invoice_tax_determinations_treatment_check" CHECK ("core_invoice_tax_determinations"."treatment" in ('standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered')),
	CONSTRAINT "core_invoice_tax_determinations_confidence_check" CHECK ("core_invoice_tax_determinations"."confidence" in ('determined','review_required')),
	CONSTRAINT "core_invoice_tax_determinations_rounding_check" CHECK ("core_invoice_tax_determinations"."rounding" in ('line','invoice')),
	CONSTRAINT "core_invoice_tax_determinations_input_provenance_check" CHECK ("core_invoice_tax_determinations"."input_provenance" in ('unverified','repository_fixture','live_signed')),
	CONSTRAINT "core_invoice_tax_determinations_determination_input_check" CHECK (jsonb_typeof("core_invoice_tax_determinations"."determination_input") = 'object'),
	CONSTRAINT "core_invoice_tax_determinations_determination_input_hash_check" CHECK ("core_invoice_tax_determinations"."determination_input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "core_invoice_tax_determinations_amount_check" CHECK ("core_invoice_tax_determinations"."treatment" = 'standard' or "core_invoice_tax_determinations"."tax_minor" = 0),
	CONSTRAINT "core_invoice_tax_determinations_review_check" CHECK (("core_invoice_tax_determinations"."confidence" = 'review_required') = (array_length("core_invoice_tax_determinations"."review_reasons", 1) >= 1))
);
--> statement-breakpoint
CREATE TABLE "core_invoice_tax_lines" (
	"invoice_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"treatment" text NOT NULL,
	"tax_code" text NOT NULL,
	"rate_ppm" bigint NOT NULL,
	"rate_kind" text NOT NULL,
	"taxable_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"rule_book_id" uuid NOT NULL,
	"rule_book_version" integer NOT NULL,
	"legal_basis" text NOT NULL,
	"notation" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_invoice_tax_lines_invoice_id_line_id_jurisdiction_pk" PRIMARY KEY("invoice_id","line_id","jurisdiction"),
	CONSTRAINT "core_invoice_tax_lines_line_id_check" CHECK ("core_invoice_tax_lines"."line_id" = 'amendment-delta' or "core_invoice_tax_lines"."line_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "core_invoice_tax_lines_jurisdiction_check" CHECK ("core_invoice_tax_lines"."jurisdiction" ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
	CONSTRAINT "core_invoice_tax_lines_treatment_check" CHECK ("core_invoice_tax_lines"."treatment" in ('standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered')),
	CONSTRAINT "core_invoice_tax_lines_tax_code_check" CHECK (length(trim("core_invoice_tax_lines"."tax_code")) > 0),
	CONSTRAINT "core_invoice_tax_lines_rate_ppm_check" CHECK ("core_invoice_tax_lines"."rate_ppm" >= 0),
	CONSTRAINT "core_invoice_tax_lines_rate_kind_check" CHECK (length(trim("core_invoice_tax_lines"."rate_kind")) > 0),
	CONSTRAINT "core_invoice_tax_lines_rule_book_version_check" CHECK ("core_invoice_tax_lines"."rule_book_version" > 0),
	CONSTRAINT "core_invoice_tax_lines_legal_basis_check" CHECK (length(trim("core_invoice_tax_lines"."legal_basis")) > 0),
	CONSTRAINT "core_invoice_tax_lines_amount_check" CHECK ("core_invoice_tax_lines"."treatment" = 'standard' or ("core_invoice_tax_lines"."tax_minor" = 0 and "core_invoice_tax_lines"."rate_ppm" = 0))
);
--> statement-breakpoint
CREATE TABLE "core_legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"legal_name" text NOT NULL,
	"merchant_role" text NOT NULL,
	"account_id" uuid,
	"established_country" text NOT NULL,
	"registered_address" jsonb NOT NULL,
	"invoice_header_text" text DEFAULT '' NOT NULL,
	"invoice_footer_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_legal_entities_legal_name_check" CHECK (length(trim("core_legal_entities"."legal_name")) > 0),
	CONSTRAINT "core_legal_entities_merchant_role_check" CHECK ("core_legal_entities"."merchant_role" in ('our_entity','partner_entity')),
	CONSTRAINT "core_legal_entities_established_country_check" CHECK ("core_legal_entities"."established_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "core_legal_entities_registered_address_check" CHECK (jsonb_typeof("core_legal_entities"."registered_address") = 'object'),
	CONSTRAINT "core_legal_entities_row_version_check" CHECK ("core_legal_entities"."row_version" > 0),
	CONSTRAINT "core_legal_entities_partner_account_check" CHECK (("core_legal_entities"."merchant_role" = 'partner_entity') = ("core_legal_entities"."account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "core_order_supplier_bindings" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"merchant_of_record" text NOT NULL,
	"supplier_legal_entity_id" uuid,
	"merchant_legal_entity_id" uuid,
	"selling_entity_assignment_id" uuid,
	"supplier_established_country" text,
	"bound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_order_supplier_bindings_merchant_of_record_check" CHECK ("core_order_supplier_bindings"."merchant_of_record" in ('fil_one','partner','marketplace')),
	CONSTRAINT "core_order_supplier_bindings_supplier_established_country_check" CHECK ("core_order_supplier_bindings"."supplier_established_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "core_order_supplier_bindings_marketplace_check" CHECK (("core_order_supplier_bindings"."merchant_of_record" = 'marketplace') = ("core_order_supplier_bindings"."supplier_legal_entity_id" is null)
        and ("core_order_supplier_bindings"."supplier_legal_entity_id" is null) = ("core_order_supplier_bindings"."merchant_legal_entity_id" is null)
        and ("core_order_supplier_bindings"."supplier_legal_entity_id" is null) = ("core_order_supplier_bindings"."selling_entity_assignment_id" is null)
        and ("core_order_supplier_bindings"."supplier_legal_entity_id" is null) = ("core_order_supplier_bindings"."supplier_established_country" is null)),
	CONSTRAINT "core_order_supplier_bindings_self_merchant_check" CHECK ("core_order_supplier_bindings"."merchant_of_record" <> 'fil_one'
        or "core_order_supplier_bindings"."merchant_legal_entity_id" = "core_order_supplier_bindings"."supplier_legal_entity_id")
);
--> statement-breakpoint
CREATE TABLE "core_selling_entity_assignments" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"account_id" uuid,
	"customer_country" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"stated_by" uuid NOT NULL,
	"stated_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_selling_entity_assignments_customer_country_check" CHECK ("core_selling_entity_assignments"."customer_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "core_selling_entity_assignments_reason_check" CHECK (length(trim("core_selling_entity_assignments"."reason")) > 0),
	CONSTRAINT "core_selling_entity_assignments_row_version_check" CHECK ("core_selling_entity_assignments"."row_version" > 0),
	CONSTRAINT "core_selling_entity_assignments_window_check" CHECK ("core_selling_entity_assignments"."effective_to" is null or "core_selling_entity_assignments"."effective_to" > "core_selling_entity_assignments"."effective_from"),
	CONSTRAINT "core_selling_entity_assignments_scope_check" CHECK ("core_selling_entity_assignments"."account_id" is null or "core_selling_entity_assignments"."customer_country" is null)
);
--> statement-breakpoint
CREATE TABLE "core_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"tax_rule_book_id" uuid NOT NULL,
	"tax_code" text NOT NULL,
	"rate_kind" text NOT NULL,
	"rate_ppm" bigint NOT NULL,
	"legal_basis" text NOT NULL,
	"notation" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_tax_rates_book_code_unique" UNIQUE("tax_rule_book_id","tax_code"),
	CONSTRAINT "core_tax_rates_tax_code_check" CHECK (length(trim("core_tax_rates"."tax_code")) > 0),
	CONSTRAINT "core_tax_rates_rate_kind_check" CHECK ("core_tax_rates"."rate_kind" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "core_tax_rates_rate_ppm_check" CHECK ("core_tax_rates"."rate_ppm" >= 0),
	CONSTRAINT "core_tax_rates_legal_basis_check" CHECK (length(trim("core_tax_rates"."legal_basis")) > 0)
);
--> statement-breakpoint
CREATE TABLE "core_tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"scheme" text NOT NULL,
	"registration_number" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"stated_by" uuid NOT NULL,
	"stated_at" timestamp with time zone NOT NULL,
	"evidence_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_tax_registrations_jurisdiction_check" CHECK ("core_tax_registrations"."jurisdiction" ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
	CONSTRAINT "core_tax_registrations_scheme_check" CHECK ("core_tax_registrations"."scheme" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "core_tax_registrations_registration_number_check" CHECK (length(trim("core_tax_registrations"."registration_number")) > 0),
	CONSTRAINT "core_tax_registrations_status_check" CHECK ("core_tax_registrations"."status" in ('pending','active','deregistered')),
	CONSTRAINT "core_tax_registrations_row_version_check" CHECK ("core_tax_registrations"."row_version" > 0),
	CONSTRAINT "core_tax_registrations_window_check" CHECK ("core_tax_registrations"."effective_to" is null or "core_tax_registrations"."effective_to" > "core_tax_registrations"."effective_from"),
	CONSTRAINT "core_tax_registrations_active_evidence_check" CHECK ("core_tax_registrations"."status" <> 'active' or "core_tax_registrations"."evidence_document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "core_tax_rule_book_activation_events" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"tax_rule_book_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"resulting_status" text NOT NULL,
	"previous_provenance" text,
	"resulting_provenance" text,
	"effective_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_tax_rule_book_activation_events_action_check" CHECK ("core_tax_rule_book_activation_events"."action" in ('activate','retire','schedule','cancel_schedule','sign','withdraw_signature')),
	CONSTRAINT "core_tax_rule_book_activation_events_reason_check" CHECK (length(trim("core_tax_rule_book_activation_events"."reason")) > 0),
	CONSTRAINT "core_tax_rule_book_activation_events_request_id_check" CHECK (length(trim("core_tax_rule_book_activation_events"."request_id")) > 0),
	CONSTRAINT "core_tax_activation_signature_check" CHECK ("core_tax_rule_book_activation_events"."action" not in ('sign','withdraw_signature') or ("core_tax_rule_book_activation_events"."previous_provenance" is not null and "core_tax_rule_book_activation_events"."resulting_provenance" is not null))
);
--> statement-breakpoint
CREATE TABLE "core_tax_rule_books" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_v7() NOT NULL,
	"jurisdiction" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"rule_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authority_reference" text NOT NULL,
	"determination_source" text DEFAULT 'local' NOT NULL,
	"input_provenance" text DEFAULT 'unverified' NOT NULL,
	"subdivision_scope" text DEFAULT 'this_level_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_tax_rule_books_jurisdiction_version_unique" UNIQUE("jurisdiction","version"),
	CONSTRAINT "core_tax_rule_books_jurisdiction_check" CHECK ("core_tax_rule_books"."jurisdiction" ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
	CONSTRAINT "core_tax_rule_books_version_check" CHECK ("core_tax_rule_books"."version" > 0),
	CONSTRAINT "core_tax_rule_books_status_check" CHECK ("core_tax_rule_books"."status" in ('draft','active','retired')),
	CONSTRAINT "core_tax_rule_books_rule_parameters_check" CHECK (jsonb_typeof("core_tax_rule_books"."rule_parameters") = 'object'),
	CONSTRAINT "core_tax_rule_books_authority_reference_check" CHECK (length(trim("core_tax_rule_books"."authority_reference")) > 0),
	CONSTRAINT "core_tax_rule_books_determination_source_check" CHECK ("core_tax_rule_books"."determination_source" in ('local','provider')),
	CONSTRAINT "core_tax_rule_books_input_provenance_check" CHECK ("core_tax_rule_books"."input_provenance" in ('unverified','repository_fixture','live_signed')),
	CONSTRAINT "core_tax_rule_books_subdivision_scope_check" CHECK ("core_tax_rule_books"."subdivision_scope" in ('whole_jurisdiction','this_level_only')),
	CONSTRAINT "core_tax_rule_books_row_version_check" CHECK ("core_tax_rule_books"."row_version" > 0),
	CONSTRAINT "core_tax_rule_books_window_check" CHECK ("core_tax_rule_books"."effective_to" is null or "core_tax_rule_books"."effective_to" > "core_tax_rule_books"."effective_from"),
	CONSTRAINT "core_tax_rule_books_retired_window_check" CHECK ("core_tax_rule_books"."status" <> 'retired' or "core_tax_rule_books"."effective_to" is not null)
);
--> statement-breakpoint
ALTER TABLE "experience_esign_return_correlations" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amendment_delta_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_treatment" text DEFAULT 'not_determined' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_supplier_legal_entity_id_core_legal_entities_id_fk" FOREIGN KEY ("supplier_legal_entity_id") REFERENCES "public"."core_legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_supplier_registration_id_core_tax_registrations_id_fk" FOREIGN KEY ("supplier_registration_id") REFERENCES "public"."core_tax_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_customer_account_id_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_determinations" ADD CONSTRAINT "core_invoice_tax_determinations_customer_registration_id_core_account_tax_identifiers_id_fk" FOREIGN KEY ("customer_registration_id") REFERENCES "public"."core_account_tax_identifiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_lines" ADD CONSTRAINT "core_invoice_tax_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_invoice_tax_lines" ADD CONSTRAINT "core_invoice_tax_lines_rule_book_id_core_tax_rule_books_id_fk" FOREIGN KEY ("rule_book_id") REFERENCES "public"."core_tax_rule_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_legal_entities" ADD CONSTRAINT "core_legal_entities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_supplier_bindings" ADD CONSTRAINT "core_order_supplier_bindings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_supplier_bindings" ADD CONSTRAINT "core_order_supplier_bindings_supplier_legal_entity_id_core_legal_entities_id_fk" FOREIGN KEY ("supplier_legal_entity_id") REFERENCES "public"."core_legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_supplier_bindings" ADD CONSTRAINT "core_order_supplier_bindings_merchant_legal_entity_id_core_legal_entities_id_fk" FOREIGN KEY ("merchant_legal_entity_id") REFERENCES "public"."core_legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_order_supplier_bindings" ADD CONSTRAINT "core_order_supplier_bindings_selling_entity_assignment_id_core_selling_entity_assignments_id_fk" FOREIGN KEY ("selling_entity_assignment_id") REFERENCES "public"."core_selling_entity_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_selling_entity_assignments" ADD CONSTRAINT "core_selling_entity_assignments_legal_entity_id_core_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."core_legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_selling_entity_assignments" ADD CONSTRAINT "core_selling_entity_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_selling_entity_assignments" ADD CONSTRAINT "core_selling_entity_assignments_stated_by_commerce_users_id_fk" FOREIGN KEY ("stated_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_rates" ADD CONSTRAINT "core_tax_rates_tax_rule_book_id_core_tax_rule_books_id_fk" FOREIGN KEY ("tax_rule_book_id") REFERENCES "public"."core_tax_rule_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_registrations" ADD CONSTRAINT "core_tax_registrations_legal_entity_id_core_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."core_legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_registrations" ADD CONSTRAINT "core_tax_registrations_stated_by_commerce_users_id_fk" FOREIGN KEY ("stated_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_registrations" ADD CONSTRAINT "core_tax_registrations_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_rule_book_activation_events" ADD CONSTRAINT "core_tax_rule_book_activation_events_tax_rule_book_id_core_tax_rule_books_id_fk" FOREIGN KEY ("tax_rule_book_id") REFERENCES "public"."core_tax_rule_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tax_rule_book_activation_events" ADD CONSTRAINT "core_tax_rule_book_activation_events_actor_user_id_commerce_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_unique" ON "notification_preferences" USING btree ("account_id","alert_kind","channel");--> statement-breakpoint
CREATE INDEX "notification_preference_account_idx" ON "notification_preferences" USING btree ("account_id","alert_kind");--> statement-breakpoint
CREATE INDEX "core_invoice_tax_determination_order_idx" ON "core_invoice_tax_determinations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "core_invoice_tax_determination_entity_idx" ON "core_invoice_tax_determinations" USING btree ("supplier_legal_entity_id","tax_point_date");--> statement-breakpoint
CREATE UNIQUE INDEX "core_invoice_tax_determination_input_unique" ON "core_invoice_tax_determinations" USING btree ("determination_input_hash");--> statement-breakpoint
CREATE INDEX "core_invoice_tax_lines_jurisdiction_idx" ON "core_invoice_tax_lines" USING btree ("jurisdiction","treatment");--> statement-breakpoint
CREATE INDEX "core_invoice_tax_lines_book_idx" ON "core_invoice_tax_lines" USING btree ("rule_book_id");--> statement-breakpoint
CREATE INDEX "core_legal_entities_account_idx" ON "core_legal_entities" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_legal_entities_partner_account_unique" ON "core_legal_entities" USING btree ("account_id") WHERE "core_legal_entities"."merchant_role" = 'partner_entity';--> statement-breakpoint
CREATE INDEX "core_order_supplier_bindings_supplier_idx" ON "core_order_supplier_bindings" USING btree ("supplier_legal_entity_id");--> statement-breakpoint
CREATE INDEX "core_order_supplier_bindings_merchant_idx" ON "core_order_supplier_bindings" USING btree ("merchant_legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_selling_entity_assignments_open_account_unique" ON "core_selling_entity_assignments" USING btree ("account_id") WHERE "core_selling_entity_assignments"."effective_to" is null and "core_selling_entity_assignments"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "core_selling_entity_assignments_open_country_unique" ON "core_selling_entity_assignments" USING btree ("customer_country") WHERE "core_selling_entity_assignments"."effective_to" is null and "core_selling_entity_assignments"."customer_country" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "core_selling_entity_assignments_open_default_unique" ON "core_selling_entity_assignments" USING btree ("effective_to") WHERE "core_selling_entity_assignments"."effective_to" is null and "core_selling_entity_assignments"."account_id" is null and "core_selling_entity_assignments"."customer_country" is null;--> statement-breakpoint
CREATE INDEX "core_selling_entity_assignments_lookup_idx" ON "core_selling_entity_assignments" USING btree ("account_id","customer_country","effective_from");--> statement-breakpoint
CREATE INDEX "core_tax_rates_book_idx" ON "core_tax_rates" USING btree ("tax_rule_book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_tax_registrations_active_unique" ON "core_tax_registrations" USING btree ("legal_entity_id","jurisdiction","scheme") WHERE "core_tax_registrations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "core_tax_registrations_lookup_idx" ON "core_tax_registrations" USING btree ("jurisdiction","status","effective_from");--> statement-breakpoint
CREATE INDEX "core_tax_registrations_entity_idx" ON "core_tax_registrations" USING btree ("legal_entity_id","status");--> statement-breakpoint
CREATE INDEX "core_tax_activation_timeline_idx" ON "core_tax_rule_book_activation_events" USING btree ("tax_rule_book_id","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_tax_rule_books_active_jurisdiction_unique" ON "core_tax_rule_books" USING btree ("jurisdiction") WHERE "core_tax_rule_books"."status" = 'active';--> statement-breakpoint
CREATE INDEX "core_tax_rule_books_resolution_idx" ON "core_tax_rule_books" USING btree ("jurisdiction","effective_from" DESC NULLS LAST,"effective_to");--> statement-breakpoint
CREATE INDEX "commission_accruals_partner_page_idx" ON "commission_accruals" USING btree ("partner_account_id","id");--> statement-breakpoint
CREATE INDEX "deal_registrations_partner_page_idx" ON "deal_registrations" USING btree ("partner_account_id","id");--> statement-breakpoint
CREATE INDEX "entitlements_order_idx" ON "entitlements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_account_page_idx" ON "invoices" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_account_page_idx" ON "orders" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_account_page_idx" ON "quotes" USING btree ("account_id","id");--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_currency_check" CHECK ("commission_accruals"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_currency_check" CHECK ("cost_records"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_currency_check" CHECK ("credit_notes"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_amount_nonnegative_check" CHECK ("credit_notes"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_currency_check" CHECK ("dispute_cases"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_amount_nonnegative_check" CHECK ("dispute_cases"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_treatment_check" CHECK ("invoices"."tax_treatment" in ('not_determined','standard','reverse_charge','exempt'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_amount_check" CHECK ("invoices"."tax_treatment" = 'standard' or "invoices"."tax_minor" = 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_check" CHECK ("invoices"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_nonnegative_check" CHECK ("invoices"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "key_terms" ADD CONSTRAINT "key_terms_liability_cap_nonnegative_check" CHECK ("key_terms"."liability_cap_minor" is null or "key_terms"."liability_cap_minor" >= 0);--> statement-breakpoint
ALTER TABLE "key_terms" ADD CONSTRAINT "key_terms_liability_cap_currency_check" CHECK ("key_terms"."liability_cap_currency" is null or "key_terms"."liability_cap_currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_approval_limit_nonnegative_check" CHECK ("memberships"."approval_limit_minor" is null or "memberships"."approval_limit_minor" >= 0);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_approval_limit_currency_check" CHECK ("memberships"."approval_limit_currency" is null or "memberships"."approval_limit_currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_price_nonnegative_check" CHECK ("order_lines"."unit_price_minor" >= 0 and "order_lines"."overage_rate_minor" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonnegative_check" CHECK ("payments"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_currency_check" CHECK ("pocs"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_cost_nonnegative_check" CHECK ("pocs"."cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_currency_check" CHECK ("price_books"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_line_total_nonnegative_check" CHECK ("quote_lines"."line_total_minor" >= 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_partner_resale_total_nonnegative_check" CHECK ("quotes"."partner_resale_total_minor" is null or "quotes"."partner_resale_total_minor" >= 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_check" CHECK ("quotes"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_floor_price_nonnegative_check" CHECK ("rate_cards"."floor_price_minor" is null or "rate_cards"."floor_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_check" CHECK ("refunds"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_nonnegative_check" CHECK ("refunds"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "core_accounting_exports" ADD CONSTRAINT "core_accounting_exports_currency_check" CHECK ("core_accounting_exports"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_amendment_financial_terms" ADD CONSTRAINT "core_amendment_financial_terms_currency_check" CHECK ("core_amendment_financial_terms"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_commission_statements" ADD CONSTRAINT "core_commission_statements_currency_check" CHECK ("core_commission_statements"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_invoice_end_client_allocations" ADD CONSTRAINT "core_invoice_end_client_allocations_currency_check" CHECK ("core_invoice_end_client_allocations"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_marketplace_events" ADD CONSTRAINT "core_marketplace_events_currency_check" CHECK ("core_marketplace_events"."currency" is null or "core_marketplace_events"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_marketplace_financial_entries" ADD CONSTRAINT "core_marketplace_financial_entries_currency_check" CHECK ("core_marketplace_financial_entries"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_marketplace_reconciliations" ADD CONSTRAINT "core_marketplace_reconciliations_currency_check" CHECK ("core_marketplace_reconciliations"."currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_stripe_adjustment_operations" ADD CONSTRAINT "core_stripe_adjustment_operations_source_currency_check" CHECK ("core_stripe_adjustment_operations"."source_currency" in ('USD','EUR','GBP'));--> statement-breakpoint
ALTER TABLE "core_three_way_tie_outs" ADD CONSTRAINT "core_three_way_tie_outs_currency_check" CHECK ("core_three_way_tie_outs"."currency" in ('USD','EUR','GBP'));