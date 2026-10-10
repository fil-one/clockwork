-- Manual reminders on template contracts are spaced by when the last one was
-- sent, as MNDA reminders are (001442). Spacing them by `updated_at` let any
-- webhook refresh hold back a reminder the signer had not received.
alter table public.commerce_contract_signing
  add column reminded_at timestamptz;

comment on column public.commerce_contract_signing.reminded_at is
  'Last manual reminder sent through SignWell; spaces reminders so a double click cannot email twice.';
