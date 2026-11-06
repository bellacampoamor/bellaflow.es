-- Catalogi: de artikellijst van elke leverancier, zoals de leverancier die aanbiedt.
-- Kolommen volgen de export supplier_catalog_items, zodat een sync of csv-import één op één past.
-- Staat los van products: pas als een artikel in het eigen assortiment komt, wordt het een product.
create table supplier_catalog_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers (id) on delete set null,
  supplier_name text not null,
  supplier_sku text not null,
  name text not null,
  url_key text not null default '',
  description_html text not null default '',
  short_description_html text not null default '',
  stock_status text not null default '',
  price_regular numeric(12, 2) not null default 0,
  price_final numeric(12, 2) not null default 0,
  currency text not null default 'EUR',
  categories jsonb not null default '[]',
  image_urls jsonb not null default '[]',
  attributes jsonb not null default '{}',
  source_hash text not null default '',
  source_updated_at timestamptz,
  active boolean not null default true,
  last_seen_run integer,
  last_synced_at timestamptz,
  unique (supplier_name, supplier_sku)
);
create index supplier_catalog_items_supplier on supplier_catalog_items (supplier_id);

alter table supplier_catalog_items enable row level security;
create policy team_all on supplier_catalog_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on supplier_catalog_items to authenticated;
