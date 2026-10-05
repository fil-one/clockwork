import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import { createRuntimeDatabase } from "../../client";
import {
  OwnerConsoleRepository,
  pendingApprovalControls,
  type PendingApproval,
} from "./owner-console";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

// Seeded fixtures (supabase/seed.sql).
const operator = "20000000-0000-4000-8000-000000000001";
const northstar = "10000000-0000-4000-8000-000000000001";
const priceBook = "60000000-0000-4000-8000-000000000001";
const taxRuleBook = "97200000-0000-4000-8000-000000000009";
const termination = "93600000-0000-4000-8000-000000000001";

it("lists one open request from every control, each with the page it is decided on", async () => {
  const rollback = new Error("ROLLBACK_OWNER_CONSOLE_FIXTURE");
  const outcome = await db
    .transaction(async (outer) => {
      const ids = {
        priceBook: randomUUID(),
        taxRuleBook: randomUUID(),
        capability: randomUUID(),
        channelPolicy: randomUUID(),
        paygOffer: randomUUID(),
        exception: randomUUID(),
      };
      await outer.execute(sql`
        insert into public.approvals
          (id, action, object_type, object_id, requested_by, status, requested_at)
        values
          (${ids.priceBook}, 'price_book_activation', 'price_book', ${priceBook},
            ${operator}, 'pending', now()),
          (${ids.taxRuleBook}, 'tax_rule_book_activation', 'tax_rule_book',
            ${taxRuleBook}, ${operator}, 'pending', now())`);
      await outer.execute(sql`
        insert into public.system_capability_requests
          (id, capability_key, base_version, enable_recovery, requested_by,
           requested_at, reason, evidence_reference)
        values (${ids.capability}, 'partner', 3, false, ${operator}, now(),
          'Partner launch preparation', 'launch-checklist')`);
      // Proposals start as drafts and are then proposed, as the guards require.
      await outer.execute(sql`
        insert into public.core_channel_policy_versions
          (id, status, terms, created_by, last_edited_by)
        values (${ids.channelPolicy}, 'draft', ${JSON.stringify({
          version: 7,
          effectiveFrom: "2026-12-01",
          selfServeThresholdTb: 100,
          defaultProtectionDays: 90,
          maximumProtectionDays: 180,
          extensionDays: 30,
          maximumExtensions: 2,
          sourceEvidence: "Board pack, October",
        })}::jsonb, ${operator}, ${operator})`);
      await outer.execute(sql`
        update public.core_channel_policy_versions
        set status = 'proposed', proposed_by = ${operator}, row_version = 2
        where id = ${ids.channelPolicy}`);
      await outer.execute(sql`
        insert into public.core_payg_offer_versions
          (id, sku, region, version, status, terms, created_by, last_edited_by)
        values (${ids.paygOffer}, 'S3-STD', 'eu-central', 1, 'draft',
          ${JSON.stringify({ sku: "S3-STD", region: "eu-central", version: 1 })}::jsonb,
          ${operator}, ${operator})`);
      await outer.execute(sql`
        update public.core_payg_offer_versions
        set status = 'proposed', proposed_by = ${operator}, row_version = 2
        where id = ${ids.paygOffer}`);
      await outer.execute(sql`
        insert into public.exception_cases
          (id, account_id, queue, object_type, object_id, owner_user_id,
           target_at, status, requester_user_id)
        values (${ids.exception}, ${northstar}, 'legal', 'quote', ${randomUUID()},
          ${operator}, now() + interval '1 day', 'open', ${operator})`);
      await outer.execute(sql`
        insert into public.experience_portal_projections
          (audience, channel, record_key, aggregate_type, aggregate_id, payload,
           source_hash, source_updated_at, source_aggregate_version)
        values ('internal', 'queues', 'queue-legal-northstar', 'exception_case',
          ${ids.exception}, '{}'::jsonb, ${"a".repeat(64)}, now(), 1)`);
      await outer.execute(sql`
        update public.lifecycle_offboarding_plans
        set plan = jsonb_set(plan, '{status}', '"pending_approval"'),
          row_version = row_version + 1
        where termination_id = ${termination}`);

      const nested = vi
        .spyOn(db, "transaction")
        .mockImplementation(outer.transaction.bind(outer));
      try {
        const reads = new OwnerConsoleRepository(db);
        const listed = new Map<string, PendingApproval[]>();
        for (const control of pendingApprovalControls)
          listed.set(
            control,
            await reads.pendingApprovals({
              control,
              requestId: `owner-console-${randomUUID()}`,
            }),
          );
        const find = (control: string, id: string) =>
          listed.get(control)?.find((item) => item.id === id);
        const requester = { userId: operator, name: "Iris Operator" };

        expect(find("price_book_activation", ids.priceBook)).toMatchObject({
          name: "Demo USD 2026",
          version: 1,
          requestedBy: requester,
          href: "/internal/price-books",
        });
        expect(find("tax_rule_book_activation", ids.taxRuleBook)).toMatchObject(
          {
            name: "US-NY-36061",
            version: 1,
            requestedBy: requester,
            href: null,
          },
        );
        expect(find("capability_activation", ids.capability)).toMatchObject({
          name: "partner",
          requestedBy: requester,
          href: "/internal/capabilities",
        });
        expect(find("channel_policy", ids.channelPolicy)).toMatchObject({
          version: 7,
          detail: "2026-12-01",
          requestedBy: requester,
          href: "/internal/channel-policy",
        });
        expect(find("payg_offer", ids.paygOffer)).toMatchObject({
          name: "S3-STD",
          version: 1,
          detail: "eu-central",
          href: "/internal/payg-offers",
        });
        expect(find("exception_case", ids.exception)).toMatchObject({
          name: "Northstar Archive Labs",
          detail: "legal",
          requestedBy: requester,
          href: "/internal/queues/queue-legal-northstar",
        });
        expect(find("termination", termination)).toMatchObject({
          name: "Northstar Archive Labs",
          href: null,
        });
        // Decided requests stay off the list: every price book request listed
        // is still pending, so the seed's approved activations are not there.
        // Other files may leave pending requests of their own, so the list is
        // not assumed to hold only this file's fixture.
        const listedIds = (listed.get("price_book_activation") ?? []).map(
          (item) => item.id,
        );
        const statuses = await outer.execute<{ status: string }>(sql`
          select status from public.approvals
          where id in (${sql.join(
            listedIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`);
        expect(statuses.map((row) => row.status)).toEqual(
          listedIds.map(() => "pending"),
        );
      } finally {
        nested.mockRestore();
      }
      throw rollback;
    })
    .catch((error: unknown) => error);
  expect(outcome).toBe(rollback);
});
