-- Details per showroomartikel van de productpagina van de leverancier: specificaties en elementen.
-- Aparte tabel, zodat supplier_showroom_items en de csv daarvan ongewijzigd blijven.
create table supplier_showroom_details (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  supplier_sku text not null,
  specifications jsonb not null default '[]',   -- [{"label": "Lengte (cm)", "value": "120"}, ...] in de volgorde van de showroom
  elements jsonb not null default '[]',         -- artikelnummers onder "Elementen", die erbij besteld kunnen worden
  scraped_at timestamptz not null default now(),
  unique (supplier_name, supplier_sku)
);

alter table supplier_showroom_details enable row level security;
create policy team_all on supplier_showroom_details for all to authenticated using (true) with check (true);
grant select, insert, update, delete on supplier_showroom_details to authenticated;
