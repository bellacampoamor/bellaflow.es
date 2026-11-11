-- Spaanse naam van een artikel (besluit Rick 11 november 2026): de kassabon is standaard Spaans, ook de omschrijving.
-- HomeDecoBali levert van elk artikel een Spaanse titel (supplier_hdb_items.title->>'es'). Die komt als name_es op het
-- catalogusartikel en op het product, zodat de kassabon hem gebruikt. Bij een uitvoering komt de naam van de
-- uitvoering erachter, zoals bij de Engelse naam ("Remos Decorativos de Madera, Set de 2 - Model 12").
-- Artikelen zonder Spaanse naam (Life Outdoor Living, HA-CO, SUNS) vertaalt de app met de woordenlijst.

alter table catalog_articles add column if not exists name_es text;
alter table products add column if not exists name_es text;

-- Spaanse naam van een HDB-catalogusartikel. Het artikelnummer van de leverancier is bij een uitvoering
-- "<sku>-<variant_id>" of de sku met dezelfde Engelse naam (meerdere uitvoeringen kunnen één sku delen).
create or replace function hdb_name_es(p_supplier_sku text, p_name text) returns text
language sql stable set search_path = public as $$
  select nullif(trim(h.title->>'es'), '') || case when coalesce(h.variant_title, '') <> '' then ' - ' || h.variant_title else '' end
  from supplier_hdb_items h
  where p_supplier_sku = h.supplier_sku || '-' || h.variant_id::text or (p_supplier_sku = h.supplier_sku and p_name = h.name)
  order by (p_supplier_sku = h.supplier_sku || '-' || h.variant_id::text) desc
  limit 1
$$;

-- Alle Spaanse namen bijwerken: catalogusartikelen van HDB en de producten die eruit komen.
create or replace function refresh_names_es() returns void
language plpgsql security definer set search_path = public as $$
begin
  update catalog_articles ca set name_es = x.es
  from (
    select ca2.id, hdb_name_es(ca2.supplier_sku, ca2.name) es
    from catalog_articles ca2 join suppliers s on s.id = ca2.supplier_id
    where s.name = 'HomeDecoBali'
  ) x
  where ca.id = x.id and x.es is not null and ca.name_es is distinct from x.es;

  update products p set name_es = ca.name_es
  from catalog_articles ca
  where ca.name_es is not null and ca.article_number = coalesce(p.catalog_article_number, p.sku)
    and p.name_es is distinct from ca.name_es;
end $$;

-- Na elke sync van HDB (nieuwe of gewijzigde titels) en na nieuwe catalogusartikelen.
create or replace function trg_refresh_names_es() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform refresh_names_es();
  return null;
end $$;

drop trigger if exists supplier_hdb_items_names_es on supplier_hdb_items;
create trigger supplier_hdb_items_names_es after insert or update on supplier_hdb_items
  for each statement execute function trg_refresh_names_es();

drop trigger if exists catalog_articles_names_es on catalog_articles;
create trigger catalog_articles_names_es after insert on catalog_articles
  for each statement execute function trg_refresh_names_es();

-- Een nieuw product (eerste verkoop van een catalogusartikel) krijgt meteen de Spaanse naam.
create or replace function trg_product_name_es() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name_es is null then
    select ca.name_es into new.name_es from catalog_articles ca
    where ca.article_number = coalesce(new.catalog_article_number, new.sku) and ca.name_es is not null limit 1;
  end if;
  return new;
end $$;

drop trigger if exists products_name_es on products;
create trigger products_name_es before insert or update on products
  for each row execute function trg_product_name_es();

revoke execute on function refresh_names_es() from public, anon;

select refresh_names_es();
