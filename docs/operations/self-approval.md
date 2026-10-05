# Approving your own request

Every two-person control still needs a second person, with one exception: a
commerce administrator may approve a request they raised themselves, with a
written reason. The right is the `approval:self` permission, held by the
`commerce_admin` role only (see
[the access matrix](../security/access-matrix.md)).

## Where it applies

| Control                                            | Where to approve                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| Price book activation and scheduled activation     | `/internal/price-books`, after the review step, or the owner console       |
| Capability switches                                | `/internal/capabilities`, or the owner console                             |
| Channel policy                                     | `/internal/channel-policy`, or the owner console                           |
| PAYG offers                                        | `/internal/payg-offers`, or the owner console                              |
| Exception decisions, including below-floor pricing | The case page under `/internal/queues`, or the owner console               |
| Terminations and teardown                          | `POST /v1/lifecycle/terminations/{id}/approvals` with `selfApproval: true` |
| Tax rule book activation                           | In the database, by an operator (see below)                                |

Production bootstrap and the MNDA countersigner are not approval controls and
are unchanged.

## How it works

1. On a request you raised, the control's page (and the owner console row marked
   "Your request") shows **Approve my own request**.
2. The dialog asks why you are approving it yourself: 8 to 500 characters. A
   channel policy also needs its approval evidence, a PAYG offer its approval
   evidence reference, and an exception its evidence document ID, exactly as an
   ordinary approval does. The reason is also the decision's reason.
3. The server checks your own session (MFA verified, not an assisted session,
   holding `approval:self`) and your stored memberships
   (`member_can_self_approve`: internal staff, enrolled in MFA, a role that
   confers `approval:self`). Everyone else gets the distinct-approver refusal
   they always got.
4. In the decision's own transaction, on the service pool, the database:
   - sets `self_approved` and `self_approval_reason` on the row that stores the
     decision (`approvals`, `system_capability_requests`,
     `core_channel_policy_versions`, `core_payg_offer_versions`,
     `exception_cases`);
   - writes one `approval.self_approved` audit event (control, subject, reason,
     approver) with no account, and its outbox row;
   - gives every other holder of `staff:manage` a notice on the owner console.

   The tenant pool can neither mark a row self-approved nor write the event.
   Once recorded, the marker and reason cannot change.

5. Teardown: once final billing has settled, one self-approval fills both
   approver slots. The plan records two entries marked `selfApproved`, both
   naming the one self-approved approval. If a second person already approved,
   the self-approval fills the remaining slot. Before final billing settles, a
   self-approval fills one slot and the plan waits in pending approval, as after
   a first ordinary approval; the requester or a second person fills the other
   slot later.

A self-approved tax rule book publishes, a self-approved price book schedule
executes, and a self-approved teardown is requested only while the approver
still holds `approval:self`. Otherwise publishing, execution or teardown refuses
(`PRICE_SCHEDULE_APPROVAL_CHANGED`, `TEARDOWN_SELF_APPROVAL_REVOKED`) and a new
approval is needed. A recorded self-approval cannot be changed, rejected after
the fact or moved to another person or subject.

### Tax rule books

Tax rule books have no portal page. An operator records a self-approval on the
pending `approvals` row from a service-pool session:

```sql
update approvals
set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = '<why, 8 to 500 characters>'
where id = '<approval id>' and action = 'tax_rule_book_activation';
```

The same checks, audit event and notices apply.

## Reviewing self-approvals

- **Owner console** (`/internal/owner`): "Recent self-approvals" lists the last
  20, newest first, with who approved, the control and record, when, and the
  reason. Each one also arrives as a notice for the other commerce
  administrators until they mark it read.
- **Audit trail**: every self-approval is an `approval.self_approved` event.

  ```sql
  select occurred_at, actor->>'id' as approver, after->>'control' as control,
         after->>'subjectType' as subject_type, after->>'subjectId' as subject_id,
         after->>'reason' as reason
  from audit_events
  where event_type = 'approval.self_approved'
  order by occurred_at desc;
  ```

- **Decision rows**: `select * from approvals where self_approved;` and the same
  filter on the other four tables listed above.

Review the log whenever a notice arrives. A self-approval that should have had a
second person is corrected through the control's own process (retire, roll back
or reject), never by editing the row.
