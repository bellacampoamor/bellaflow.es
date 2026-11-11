-- HomeDecoBali (HDB): ruwe catalogus uit de HomeDecoBali Partner Catalog API v1 en de kolommen voor voorraad zonder inkoop.
-- Op 7 november 2026 rechtstreeks in Supabase uitgevoerd (supplier_homedecobali, catalog_articles_source_hdb,
-- homedecobali_stock_no_purchase, supplier_stock_warehouse); hier vastgelegd zodat een lege database dezelfde
-- structuur krijgt. Alles is idempotent: op de live database verandert dit niets.
-- De sync-functies (claim_/apply_supplier_hdb_sync, sync_catalog_articles_hdb) staan alleen in Supabase en draaien vanuit n8n.

create table if not exists supplier_hdb_items (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null default 'HomeDecoBali',
  product_id text not null,
  variant_id text not null,
  supplier_sku text not null,
  handle text not null default '',
  name text not null default '',
  variant_title text not null default '',
  title jsonb not null default '{}'::jsonb,
  description_text jsonb not null default '{}'::jsonb,
  ean text not null default '',
  product_type text not null default '',
  tags jsonb not null default '[]'::jsonb,
  collections jsonb not null default '[]'::jsonb,
  options jsonb not null default '{}'::jsonb,
  images jsonb not null default '[]'::jsonb,
  image_url text not null default '',
  url jsonb not null default '{}'::jsonb,
  price numeric,
  compare_at_price numeric,
  purchase_price numeric,
  currency text not null default 'EUR',
  available boolean,
  inventory_quantity integer,
  inventory_policy text not null default '',
  is_preorder boolean not null default false,
  preorder_eta text not null default '',
  pickup_only boolean not null default false,
  minimum_quantity integer,
  weight_kg numeric,
  specs jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  removed_at timestamptz,
  source_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  scraped_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_name, variant_id)
);
create index if not exists supplier_hdb_items_product on supplier_hdb_items (supplier_name, product_id);
create index if not exists supplier_hdb_items_sku on supplier_hdb_items (supplier_name, lower(supplier_sku));

alter table supplier_hdb_items enable row level security;
drop policy if exists team_all on supplier_hdb_items;
create policy team_all on supplier_hdb_items for all to authenticated using (is_team_member()) with check (is_team_member());

-- Voorraad volgens de koppeling (HDB: direct beschikbaar bij Bella, er wordt niet ingekocht)
alter table catalog_articles add column if not exists supplier_stock integer;
alter table catalog_articles add column if not exists supplier_stock_at timestamptz;
alter table catalog_articles add column if not exists preorder_eta text not null default '';
alter table suppliers add column if not exists purchase_required boolean not null default true;
alter table suppliers add column if not exists stock_warehouse_id uuid references warehouses(id);
