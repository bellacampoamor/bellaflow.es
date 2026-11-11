-- Kassaverkopen van HDB als conceptorder in de Shopify van HomeDecoBali (opdracht Rick 11 november 2026).
-- Per eenvoudige factuur van HDB één rij: de wachtrij voor de edge function hdb-shopify en daarna het resultaat
-- (conceptorder #D.. en het ordernummer dat Shopify toekent). De factuur zelf blijft onwijzigbaar.
create table if not exists hdb_shopify_orders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references invoices(id),
  -- wachtrij: nog te versturen; bezig: wordt verstuurd; aangemaakt: staat in Shopify; mislukt: zie error; demo: browserversie.
  status text not null default 'wachtrij' check (status in ('wachtrij', 'bezig', 'aangemaakt', 'mislukt', 'demo')),
  -- true: de conceptorder wordt meteen een bestelling (als betaald) met een Shopify-ordernummer. false: blijft conceptorder.
  complete_order boolean not null default true,
  shopify_draft_id text not null default '',
  shopify_draft_name text not null default '',
  shopify_order_id text not null default '',
  shopify_order_name text not null default '',
  error text not null default '',
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists hdb_shopify_orders_status_idx on hdb_shopify_orders (status, created_at);

alter table hdb_shopify_orders enable row level security;
create policy team_read on hdb_shopify_orders for select to authenticated using ((select public.is_team_member()));
create policy team_insert on hdb_shopify_orders for insert to authenticated with check ((select public.is_team_member()));
create policy team_update on hdb_shopify_orders for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
grant select, insert, update on hdb_shopify_orders to authenticated;

-- Instelling onder Instellingen > Bedrijf en factuur > Kassa: HDB. Standaard: meteen een bestelling met Shopify-nummer.
alter table settings add column if not exists hdb_shopify_complete boolean not null default true;
-- Naam van de winkel in Shopify (admin.shopify.com/store/<naam>), alleen voor de links naar de bestelling. Geen sleutel.
alter table settings add column if not exists hdb_shopify_store text not null default '';
