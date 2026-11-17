-- HomeDecoBali: eigen foto per variant (melding Rick 16 november 2026).
-- Bij een product met varianten (bijv. Deco sticks 2026, 12 models) kreeg elke variant de eerste foto van het product,
-- omdat de Partner Catalog API per variant geen foto meegeeft. De edge function hdb-variant-images leest de foto per
-- variant uit de Shopify van HomeDecoBali (Admin API, dezelfde app als hdb-shopify) en zet die hier vast.
-- n8n roept die functie aan na elke catalogus-sync. De uurlijkse sync overschrijft de variantfoto daarna niet meer.

alter table supplier_hdb_items add column if not exists variant_image_url text not null default '';

-- 1. De catalogus-sync: variantfoto gaat voor op de eerste foto van het product.
--    Levert de API ooit zelf een variantfoto (variant.image.url of variant.image_url), dan wordt die gebruikt.
create or replace function public.apply_supplier_hdb_sync(p_supplier text, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mode text := coalesce(p_payload ->> 'mode', 'delta');
  v_products jsonb := coalesce(p_payload -> 'products', '[]'::jsonb);
  v_run bigint; v_rows int := 0; v_removed int := 0; v_off int := 0; v_seen int; v_before int;
  v_cursor timestamptz; v_old_cursor text; v_cat jsonb;
begin
  if not exists (select 1 from suppliers where lower(trim(name)) = lower(trim(p_supplier))) then
    raise exception 'Leverancier % staat niet onder Beheer.', p_supplier;
  end if;
  insert into integration_runs (name, status) values ('homedecobali_' || v_mode, 'running') returning id into v_run;

  with r as (
    update supplier_hdb_items i set active = false, removed_at = coalesce((p ->> 'removed_at')::timestamptz, now()),
      source_updated_at = (p ->> 'updated_at')::timestamptz, updated_at = now()
    from jsonb_array_elements(v_products) p
    where i.supplier_name = p_supplier and i.product_id = p ->> 'id' and (p ->> 'active')::boolean is false and i.active
    returning 1
  ) select count(*) into v_removed from r;

  drop table if exists pg_temp.hdb_rows;
  create temp table hdb_rows on commit drop as
  select p ->> 'id' as product_id, v ->> 'id' as variant_id,
    coalesce(nullif(trim(v ->> 'sku'), ''), 'V' || (v ->> 'id')) as supplier_sku,
    coalesce(p ->> 'handle', '') as handle,
    left(trim(coalesce(p -> 'title' ->> 'en', p -> 'title' ->> 'es', '')
      || case when jsonb_array_length(coalesce(p -> 'variants', '[]')) > 1 and coalesce(v ->> 'title', '') not in ('', 'Default Title')
              then ' - ' || (v ->> 'title') else '' end), 300) as name,
    coalesce(v ->> 'title', '') as variant_title,
    coalesce(p -> 'title', '{}') as title,
    coalesce(p -> 'description_text', '{}') as description_text,
    coalesce(v ->> 'barcode', '') as ean,
    coalesce(p ->> 'product_type', '') as product_type,
    coalesce(p -> 'tags', '[]') as tags,
    coalesce(p -> 'collections', '[]') as collections,
    coalesce(v -> 'options', '{}') as options,
    coalesce(p -> 'images', '[]') as images,
    coalesce((select i ->> 'url' from jsonb_array_elements(coalesce(p -> 'images', '[]')) i order by (i ->> 'position')::int nulls last limit 1), '') as image_url,
    coalesce(nullif(case when jsonb_typeof(v -> 'image') = 'object' then v -> 'image' ->> 'url' end, ''), nullif(v ->> 'image_url', ''), '') as variant_image_url,
    coalesce(p -> 'url', '{}') as url,
    (v ->> 'price')::numeric as price,
    (v ->> 'compare_at_price')::numeric as compare_at_price,
    coalesce(p -> 'price' ->> 'currency', 'EUR') as currency,
    (v ->> 'available')::boolean as available,
    (v ->> 'inventory_quantity')::numeric::int as inventory_quantity,
    coalesce(v ->> 'inventory_policy', '') as inventory_policy,
    coalesce((p -> 'preorder' ->> 'is_preorder')::boolean, false) as is_preorder,
    coalesce(p -> 'preorder' ->> 'eta', '') as preorder_eta,
    coalesce((p -> 'shipping' ->> 'pickup_only')::boolean, false) as pickup_only,
    (p ->> 'minimum_quantity')::numeric::int as minimum_quantity,
    coalesce((v ->> 'weight_kg')::numeric, (p -> 'shipping' ->> 'weight_kg')::numeric) as weight_kg,
    coalesce(p -> 'specs', '{}') as specs,
    coalesce(p -> 'attributes', '{}') as attributes,
    (p ->> 'updated_at')::timestamptz as source_updated_at,
    p - 'variants' || jsonb_build_object('variant', v) as raw
  from jsonb_array_elements(v_products) p
  cross join lateral jsonb_array_elements(coalesce(p -> 'variants', '[]')) v
  where coalesce((p ->> 'active')::boolean, true);

  insert into supplier_hdb_items as i (supplier_name, product_id, variant_id, supplier_sku, handle, name, variant_title, title,
    description_text, ean, product_type, tags, collections, options, images, image_url, variant_image_url, url, price, compare_at_price,
    currency, available, inventory_quantity, inventory_policy, is_preorder, preorder_eta, pickup_only, minimum_quantity, weight_kg, specs,
    attributes, active, removed_at, source_updated_at, raw, scraped_at, updated_at)
  select p_supplier, product_id, variant_id, supplier_sku, handle, name, variant_title, title, description_text, ean, product_type,
    tags, collections, options, images, coalesce(nullif(variant_image_url, ''), image_url), variant_image_url, url, price,
    compare_at_price, currency, available, inventory_quantity, inventory_policy, is_preorder, preorder_eta, pickup_only,
    minimum_quantity, weight_kg, specs, attributes, true, null, source_updated_at, raw, now(), now()
  from hdb_rows
  on conflict (supplier_name, variant_id) do update set
    product_id = excluded.product_id, supplier_sku = excluded.supplier_sku, handle = excluded.handle, name = excluded.name,
    variant_title = excluded.variant_title, title = excluded.title, description_text = excluded.description_text, ean = excluded.ean,
    product_type = excluded.product_type, tags = excluded.tags, collections = excluded.collections, options = excluded.options,
    images = excluded.images,
    -- excluded.image_url is hier al de variantfoto van de API of anders de eerste productfoto.
    variant_image_url = coalesce(nullif(excluded.variant_image_url, ''), i.variant_image_url),
    image_url = coalesce(nullif(excluded.variant_image_url, ''), nullif(i.variant_image_url, ''), excluded.image_url),
    url = excluded.url, price = excluded.price,
    compare_at_price = excluded.compare_at_price, currency = excluded.currency, available = excluded.available,
    inventory_quantity = excluded.inventory_quantity, inventory_policy = excluded.inventory_policy,
    is_preorder = excluded.is_preorder, preorder_eta = excluded.preorder_eta, pickup_only = excluded.pickup_only,
    minimum_quantity = excluded.minimum_quantity, weight_kg = excluded.weight_kg, specs = excluded.specs,
    attributes = excluded.attributes, active = true, removed_at = null, source_updated_at = excluded.source_updated_at,
    raw = excluded.raw, scraped_at = now(), updated_at = now();
  get diagnostics v_rows = row_count;

  with g as (
    update supplier_hdb_items i set active = false, removed_at = now(), updated_at = now()
    where i.supplier_name = p_supplier and i.active
      and i.product_id in (select distinct product_id from hdb_rows)
      and not exists (select 1 from hdb_rows r where r.variant_id = i.variant_id)
    returning 1
  ) select count(*) into v_off from g;

  if v_mode = 'full' then
    select count(distinct product_id) into v_seen from hdb_rows;
    select count(distinct product_id) into v_before from supplier_hdb_items where supplier_name = p_supplier and active;
    if v_before > 0 and v_seen < v_before * 0.8 then
      raise exception 'HomeDecoBali: volledige run gaf % producten, eerder % actief. Niets uitgezet.', v_seen, v_before;
    end if;
    with f as (
      update supplier_hdb_items i set active = false, removed_at = now(), updated_at = now()
      where i.supplier_name = p_supplier and i.active and not exists (select 1 from hdb_rows r where r.variant_id = i.variant_id)
      returning 1
    ) select v_off + count(*) into v_off from f;
  end if;

  select max((p ->> 'updated_at')::timestamptz) into v_cursor from jsonb_array_elements(v_products) p;
  insert into supplier_sync_state (supplier_name) values (p_supplier) on conflict (supplier_name) do nothing;
  select last_result ->> 'cursor' into v_old_cursor from supplier_sync_state where supplier_name = p_supplier;
  update supplier_sync_state set
    last_result = jsonb_build_object(
      'cursor', to_char(greatest(v_cursor, v_old_cursor::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'mode', v_mode, 'products', jsonb_array_length(v_products), 'variants', v_rows, 'removed', v_removed, 'deactivated', v_off,
      'catalog_synced_at', p_payload ->> 'catalog_synced_at'),
    cycle_date = case when v_mode = 'full' then (now() at time zone 'Europe/Madrid')::date else cycle_date end,
    cycle_started_at = case when v_mode = 'full' then now() else cycle_started_at end,
    finished_at = now(), last_run_at = now()
  where supplier_name = p_supplier;

  v_cat := sync_catalog_articles(p_supplier);
  update integration_runs set status = 'klaar', finished_at = now(),
    summary = jsonb_build_object('mode', v_mode, 'products', jsonb_array_length(v_products), 'variants', v_rows,
      'removed', v_removed, 'deactivated', v_off, 'catalog', v_cat) where id = v_run;
  return jsonb_build_object('mode', v_mode, 'products', jsonb_array_length(v_products), 'variants', v_rows,
    'removed', v_removed, 'deactivated', v_off, 'catalog', v_cat);
end $function$;

do $$
begin
  execute 'revoke all on function public.apply_supplier_hdb_sync(text, jsonb) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.apply_supplier_hdb_sync(text, jsonb) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.apply_supplier_hdb_sync(text, jsonb) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.apply_supplier_hdb_sync(text, jsonb) to service_role'; end if;
end $$;

-- 2. Variantfoto's uit Shopify vastzetten: [{ "variant_id": "559...", "url": "https://cdn.shopify.com/..." }, ...].
--    Een lege url betekent: deze variant heeft in Shopify geen eigen foto, dan geldt de eerste productfoto.
--    Alleen varianten die in de lijst staan worden bijgewerkt. Daarna de eigen catalogus (catalog_articles) bijwerken.
create or replace function public.apply_hdb_variant_images(p_images jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_changed int := 0; v_cat jsonb;
begin
  with x as (
    select distinct on (e ->> 'variant_id') e ->> 'variant_id' as variant_id, coalesce(trim(e ->> 'url'), '') as url
    from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) e
    where coalesce(e ->> 'variant_id', '') <> ''
  ), u as (
    update supplier_hdb_items i set
      variant_image_url = x.url,
      image_url = coalesce(nullif(x.url, ''),
        (select im ->> 'url' from jsonb_array_elements(i.images) im order by (im ->> 'position')::int nulls last limit 1), ''),
      updated_at = now()
    from x
    where i.supplier_name = 'HomeDecoBali' and i.variant_id = x.variant_id
      and (i.variant_image_url, i.image_url) is distinct from (x.url, coalesce(nullif(x.url, ''),
        (select im ->> 'url' from jsonb_array_elements(i.images) im order by (im ->> 'position')::int nulls last limit 1), ''))
    returning 1
  ) select count(*) into v_changed from u;
  if v_changed > 0 then v_cat := sync_catalog_articles('HomeDecoBali'); end if;
  return jsonb_build_object('received', jsonb_array_length(coalesce(p_images, '[]'::jsonb)), 'changed', v_changed, 'catalog', v_cat);
end $function$;

do $$
begin
  execute 'revoke all on function public.apply_hdb_variant_images(jsonb) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.apply_hdb_variant_images(jsonb) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.apply_hdb_variant_images(jsonb) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.apply_hdb_variant_images(jsonb) to service_role'; end if;
end $$;
