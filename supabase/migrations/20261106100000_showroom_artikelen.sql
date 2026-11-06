-- Showroom van de leverancier: de dealercatalogus op variantniveau, zoals Bella die ziet na inloggen.
-- Wordt gevuld met een csv-export van de showroom. Kolommen gelijk aan de kopregel van die csv.
-- Staat naast supplier_catalog_items (de consumentenwebshop) en los van de eigen producten.
create table supplier_showroom_items (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  supplier_sku text not null,
  name text not null,
  ean text not null default '',
  series text not null default '',
  categories text not null default '',           -- categorieën van de showroom, gescheiden door " | "
  price numeric(12, 2),                          -- prijs zoals de showroom die toont
  currency text not null default 'EUR',
  available_date date,                           -- "Beschikbaar in magazijn" van de leverancier
  available_text text not null default '',       -- de tekst zoals getoond, bijvoorbeeld "Geen datum beschikbaar"
  image_url text not null default '',
  product_url text not null default '',
  scraped_at timestamptz not null default now(),
  unique (supplier_name, supplier_sku)
);
create index supplier_showroom_items_series on supplier_showroom_items (supplier_name, series);

alter table supplier_showroom_items enable row level security;
create policy team_all on supplier_showroom_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on supplier_showroom_items to authenticated;
