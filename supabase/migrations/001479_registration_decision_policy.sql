-- Channel ops decides registrations with `quote:approve`, which the core API
-- requires for approve, reject, convert and dispute decisions. The row-level
-- update guard admitted only `deal:register` and `operations:write`, so a
-- finance approver passed the API and was refused here. Partner-side rules are
-- unchanged: partners still update only through `deal:register`, and which
-- verbs they may send is decided by the API permission map. The test stays an
-- initplan (one evaluation per statement), as 001454 requires.
set lock_timeout = '5s';

alter policy guard_u_deal_registrations_606b79cc on public.deal_registrations
  using ((select app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text, 'quote:approve'::text])))
  with check ((select app_has_any_permission(ARRAY['deal:register'::text, 'operations:write'::text, 'quote:approve'::text])));

reset lock_timeout;
