CREATE TABLE "membership_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "membership_roles_membership_role_unique" UNIQUE("membership_id","role"),
	CONSTRAINT "membership_roles_reason_check" CHECK ("membership_roles"."reason" is null or length(trim("membership_roles"."reason")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "organization_side_roles" (
	"side" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "organization_side_roles_side_role_pk" PRIMARY KEY("side","role")
);
--> statement-breakpoint
CREATE TABLE "organization_side_withheld_permissions" (
	"side" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "organization_side_withheld_permissions_side_permission_pk" PRIMARY KEY("side","permission")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "staff_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "staff_notices_recipient_event_unique" UNIQUE("recipient_user_id","audit_event_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_granted_by_commerce_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notices" ADD CONSTRAINT "staff_notices_recipient_user_id_commerce_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."commerce_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notices" ADD CONSTRAINT "staff_notices_audit_event_id_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_roles_role_idx" ON "membership_roles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "staff_notices_unread_idx" ON "staff_notices" USING btree ("recipient_user_id","created_at" DESC NULLS LAST) WHERE "staff_notices"."read_at" is null;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_side_check" CHECK ("organizations"."side" in ('fil_one','customer','channel_partner','referral_partner'));