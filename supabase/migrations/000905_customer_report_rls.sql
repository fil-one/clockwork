-- Customer-facing reports must execute as clockwork_runtime so the
-- security-invoker views apply underlying table RLS. Internal management
-- views deliberately remain service-only.
grant select on
  core_revenue_forecast,
  core_renewal_churn_exposure,
  core_partner_performance,
  core_funnel_cycle_time,
  core_margin_poc_cost
to clockwork_runtime;
