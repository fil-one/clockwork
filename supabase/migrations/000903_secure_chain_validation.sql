-- Quote-line validation must be able to compare a submitted line to the
-- confidential rate-card source without granting tenant sessions access to
-- pricing floors, accounting mappings, or partner economics. The trigger is
-- read-only and its fixed search path prevents object-shadowing attacks.

alter function public.validate_commerce_chain() owner to postgres;
alter function public.validate_commerce_chain() security definer;
alter function public.validate_commerce_chain()
  set search_path = public, pg_temp;

revoke all on function public.validate_commerce_chain()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

comment on function public.validate_commerce_chain() is
  'Security-definer read-only chain validator; exposes no confidential pricing values.';
