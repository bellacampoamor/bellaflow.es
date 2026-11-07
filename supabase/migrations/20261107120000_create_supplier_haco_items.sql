-- Catalogus van leverancier Coöperatieve Inkoopvereniging Ha-Co U.A., uit het MOS-portaal (haco.ordertechniek.nl).
-- Zelfde basis als supplier_showroom_items (Life): sleutel (supplier_name, supplier_sku), hashes voor wijzigingsdetectie, listed/active.
create table if not exists public.supplier_haco_items (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null default 'Coöperatieve Inkoopvereniging Ha-Co U.A.',
  supplier_sku text not null,                       -- HA-CO productnummer, bv. 0034342
  name text not null default '',                    -- Naam
  variant text not null default '',                 -- Uitvoering
  description text not null default '',             -- Omschrijving
  ean text not null default '',
  series text not null default '',
  categories text not null default '',              -- Omzetgroep
  stat_groups jsonb not null default '[]'::jsonb,   -- Statistiekgroepen
  stock_type text not null default '' check (stock_type in ('', 'V', 'C')), -- V = voorraadartikel, C = commissie-/catalogusartikel
  parent_sku text not null default '',              -- Parent
  price numeric,                                    -- Verkoopprijs HA-CO (consumentenprijs NL, incl. BTW)
  purchase_price numeric,                           -- Inkoopprijs HA-CO bij de fabrikant (excl. BTW)
  currency text not null default 'EUR',
  vat_rate numeric,                                 -- BTW-percentage, bv. 21
  assembly_cost numeric,                            -- Montagekosten
  assembly_units integer,                           -- Montagetijdseenheid
  min_stock integer,                                -- Minimale voorraad
  min_order integer,                                -- Minimaal bestellen
  colli integer,                                    -- Aantal colli
  volume_m3 numeric,                                -- Verpakkingsvolume (m3)
  weight_kg numeric,                                -- Gewicht (kg)
  remarks text not null default '',                 -- Opmerkingen
  status_text text not null default '',             -- Status
  show_on_website boolean,
  manufacturer_name text not null default '',       -- Leverancier gegevens: fabrikant
  manufacturer_sku text not null default '',        -- Productnummer bij fabrikant
  manufacturer_product_name text not null default '',
  manufacturer_variant text not null default '',
  mandatory_properties jsonb not null default '[]'::jsonb, -- Verplichte eigenschappen (bv. Afmeting, Kleur)
  documents jsonb not null default '[]'::jsonb,     -- [{name,url}] uit /uploads/Product/
  image_url text not null default '',               -- eerste afbeelding uit documents
  product_url text not null default '',
  stock_current integer,                            -- Voorraadlijst centraal: V
  stock_allocated integer,                          -- T
  stock_available integer,                          -- DB
  stock_on_order integer,                           -- B
  stock_reserved integer,                           -- G
  stock_available_later integer,                    -- LB
  stock_in_order integer,                           -- O
  stock_checked_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  scraped_at timestamptz not null default now(),
  listed boolean not null default true,
  active boolean not null default true,
  source_hash text not null default '',
  content_hash text not null default '',
  content_changed_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now(),
  unique (supplier_name, supplier_sku)
);
create index if not exists supplier_haco_items_manufacturer on public.supplier_haco_items (supplier_name, manufacturer_name);
create index if not exists supplier_haco_items_categories on public.supplier_haco_items (supplier_name, categories);
alter table public.supplier_haco_items enable row level security;
drop policy if exists team_all on public.supplier_haco_items;
create policy team_all on public.supplier_haco_items for all to authenticated using (true) with check (true);
