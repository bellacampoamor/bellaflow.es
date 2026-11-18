-- Kassa: voorraad van HomeDecoBali (besluit Rick 18 november 2026).
-- De hele voorraad van HDB ligt in het magazijn van Bella. Voor een HDB-artikel is de beschikbare voorraad aan de kassa
-- daarom de voorraad uit de catalogus van HomeDecoBali (catalog_articles.supplier_stock, bijgewerkt door de sync van HDB).
-- 1. search_catalog_articles geeft ook supplier_stock terug, zodat de zoeklijst de voorraad toont.
-- 2. adjust_supplier_stock: na een kassaverkoop gaat de voorraad van HDB direct omlaag, na een retour omhoog. De volgende
--    sync van HDB zet hem weer gelijk aan die van HomeDecoBali (Shopify).
-- Herhaalbaar.

drop function if exists search_catalog_articles(text, uuid[], integer);
create function search_catalog_articles(p_q text, p_suppliers uuid[] default null, p_limit integer default 30)
returns table (id uuid, article_number text, supplier_id uuid, supplier_sku text, ean text, name text, category_code text, series text,
  price numeric, currency text, image_url text, source text, active boolean, created_at timestamptz, element_count integer,
  variant_of uuid, variant_count integer, parent_name text, supplier_stock integer)
language sql stable set search_path = public as $$
  with t as (select lower(trim(coalesce(p_q, ''))) as q),
  w as (
    select array_agg('%' || replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%' order by length(x) desc) as pats
    from t, regexp_split_to_table(t.q, '\s+') x where x <> ''
  )
  select a.id, a.article_number, a.supplier_id, a.supplier_sku, a.ean, a.name, a.category_code, a.series, a.price, a.currency,
    a.image_url, a.source, a.active, a.created_at,
    (select count(*)::int from catalog_article_elements e where e.parent_id = a.id) as element_count,
    a.variant_of,
    (select count(*)::int from catalog_articles v where v.variant_of = a.id and v.active) as variant_count,
    (select p.name from catalog_articles p where p.id = a.variant_of) as parent_name,
    a.supplier_stock
  from catalog_articles a, t, w
  where w.pats is not null and a.active
    and (p_suppliers is null or a.supplier_id = any (p_suppliers))
    and a.search_text like w.pats[1] and a.search_text like all (w.pats)
  order by
    case when lower(a.article_number) = t.q or lower(a.supplier_sku) = t.q or a.ean = t.q then 0
         when lower(a.supplier_sku) like t.q || '%' or lower(a.article_number) like t.q || '%' then 1
         when lower(a.name) like t.q || '%' then 2 else 3 end,
    a.name, a.article_number
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- Alleen artikelen van HomeDecoBali met een bekende voorraad; nooit onder 0. Alleen voor teamleden.
create or replace function adjust_supplier_stock(p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_team_member() then raise exception 'Geen medewerker met toegang.'; end if;
  with c as (
    select x ->> 'article_number' as article_number, sum((x ->> 'delta')::int) as delta
    from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) x group by 1
  ), u as (
    update catalog_articles a set supplier_stock = greatest(a.supplier_stock + c.delta, 0)
    from c
    where a.article_number = c.article_number and a.source = 'hdb' and a.supplier_stock is not null and c.delta <> 0
    returning 1
  ) select count(*) into v_n from u;
  return v_n;
end $$;

do $$
begin
  execute 'revoke execute on function search_catalog_articles(text, uuid[], integer) from public';
  execute 'revoke execute on function adjust_supplier_stock(jsonb) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function search_catalog_articles(text, uuid[], integer) from anon';
    execute 'revoke execute on function adjust_supplier_stock(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function search_catalog_articles(text, uuid[], integer) to authenticated';
    execute 'grant execute on function adjust_supplier_stock(jsonb) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function search_catalog_articles(text, uuid[], integer) to service_role';
    execute 'grant execute on function adjust_supplier_stock(jsonb) to service_role';
  end if;
end $$;
