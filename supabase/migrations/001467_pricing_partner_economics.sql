-- Partner economics on a saved pricing scenario: the seller's referral,
-- resale or other partner inputs, kept with the scenario so it reopens and
-- prints as it was entered. Null is a direct scenario with no partner.
--
-- One nullable jsonb column, validated by the application schema on every
-- write and read as `lines` already is. The inputs are indicative and still
-- changing (commission step-downs, resale margins, ad hoc shares), so a
-- column per input would need a migration for each new model. Derived
-- figures are never stored; readers recompute them from the lines and these
-- inputs. No floor or transfer price is read or written here.
set lock_timeout = '5s';

alter table public.commerce_pricing_scenarios
  add column if not exists partner_economics jsonb;

alter table public.commerce_pricing_scenarios
  drop constraint if exists commerce_pricing_scenarios_partner_economics_check;

alter table public.commerce_pricing_scenarios
  add constraint commerce_pricing_scenarios_partner_economics_check
  check (partner_economics is null or (jsonb_typeof(partner_economics) = 'object'
    and partner_economics->>'model' in ('referral','resale','other')));

comment on column public.commerce_pricing_scenarios.partner_economics is
  'Seller-entered partner inputs (referral, resale or other); null for direct. Indicative only, figures recomputed on read.';

reset lock_timeout;
