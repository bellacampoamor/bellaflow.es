-- Nachtelijke sync van de showroom van Life Outdoor Living via n8n.
-- Alleen wat veranderd is wordt geschreven: elke regel krijgt een vingerafdruk (source_hash) en
-- een regel met dezelfde vingerafdruk wordt niet opnieuw opgeslagen.

alter table supplier_showroom_items
  add column if not exists product_id integer,
  add column if not exists listed boolean not null default true,   -- staat in de artikellijst van de showroom; false = alleen als element op een productpagina
  add column if not exists active boolean not null default true,   -- false = niet meer in de showroom gevonden
  add column if not exists source_hash text not null default '',
  add column if not exists updated_at timestamptz not null default now();

-- De elementen uit de handmatige export (zonder EAN en zonder beschikbaarheid) staan niet in de lijst.
update supplier_showroom_items set listed = false
where listed and ean = '' and available_text = '' and categories = '';

alter table supplier_showroom_details
  add column if not exists source_hash text not null default '',
  add column if not exists checked_at timestamptz;
update supplier_showroom_details set checked_at = scraped_at where checked_at is null;

-- Artikelen uit de lijst. p_rows: [{supplier_sku, product_id, name, ean, series, categories, price,
-- available_date, available_text, image_url, product_url, source_hash}]
create or replace function sync_supplier_showroom_items(p_supplier text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int; v_changed int; v_total int;
begin
  select count(*) into v_total from jsonb_array_elements(p_rows);
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(supplier_sku text, product_id int, name text, ean text, series text, categories text,
      price numeric, available_date date, available_text text, image_url text, product_url text, source_hash text)
    where coalesce(r.supplier_sku, '') <> ''
  ), up as (
    insert into supplier_showroom_items as t (supplier_name, supplier_sku, product_id, name, ean, series, categories, price, currency,
      available_date, available_text, image_url, product_url, listed, active, source_hash, scraped_at, updated_at)
    select p_supplier, s.supplier_sku, s.product_id, coalesce(s.name, ''), coalesce(s.ean, ''), coalesce(s.series, ''), coalesce(s.categories, ''),
      s.price, 'EUR', s.available_date, coalesce(s.available_text, ''), coalesce(s.image_url, ''), coalesce(s.product_url, ''), true, true,
      coalesce(s.source_hash, ''), now(), now()
    from src s
    on conflict (supplier_name, supplier_sku) do update set
      product_id = excluded.product_id, name = excluded.name, ean = excluded.ean, series = excluded.series, categories = excluded.categories,
      price = excluded.price, available_date = excluded.available_date, available_text = excluded.available_text,
      image_url = excluded.image_url, product_url = excluded.product_url, listed = true, active = true,
      source_hash = excluded.source_hash, scraped_at = now(), updated_at = now()
    where t.source_hash is distinct from excluded.source_hash or not t.active or not t.listed
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_new, v_changed from up;
  return jsonb_build_object('rows', v_total, 'new', v_new, 'changed', v_changed, 'unchanged', v_total - v_new - v_changed);
end $$;

-- Elementen die alleen op productpagina's staan. Een artikel uit de lijst wordt hier nooit overschreven.
-- p_rows: [{supplier_sku, name, price, available_date, available_text, image_url, product_url, source_hash}]
create or replace function sync_supplier_showroom_elements(p_supplier text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int; v_changed int; v_total int;
begin
  select count(*) into v_total from jsonb_array_elements(p_rows);
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(supplier_sku text, name text, price numeric, available_date date, available_text text,
      image_url text, product_url text, source_hash text)
    where coalesce(r.supplier_sku, '') <> ''
  ), up as (
    insert into supplier_showroom_items as t (supplier_name, supplier_sku, name, price, currency, available_date, available_text,
      image_url, product_url, listed, active, source_hash, scraped_at, updated_at)
    select p_supplier, s.supplier_sku, coalesce(s.name, ''), s.price, 'EUR', s.available_date, coalesce(s.available_text, ''),
      coalesce(s.image_url, ''), coalesce(s.product_url, ''), false, true, coalesce(s.source_hash, ''), now(), now()
    from src s
    on conflict (supplier_name, supplier_sku) do update set
      name = excluded.name, price = excluded.price, available_date = excluded.available_date, available_text = excluded.available_text,
      image_url = excluded.image_url, product_url = excluded.product_url, active = true,
      source_hash = excluded.source_hash, scraped_at = now(), updated_at = now()
    where not t.listed and (t.source_hash is distinct from excluded.source_hash or not t.active)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_new, v_changed from up;
  return jsonb_build_object('rows', v_total, 'new', v_new, 'changed', v_changed, 'unchanged', v_total - v_new - v_changed);
end $$;

-- Specificaties en elementen per productpagina. checked_at wordt altijd bijgewerkt, zodat de rondgang verder schuift.
-- p_rows: [{supplier_sku, specifications, elements, source_hash}]
create or replace function sync_supplier_showroom_details(p_supplier text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int; v_changed int; v_total int;
begin
  select count(*) into v_total from jsonb_array_elements(p_rows);
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(supplier_sku text, specifications jsonb, elements jsonb, source_hash text)
    where coalesce(r.supplier_sku, '') <> ''
  ), up as (
    insert into supplier_showroom_details as t (supplier_name, supplier_sku, specifications, elements, source_hash, scraped_at, checked_at)
    select p_supplier, s.supplier_sku, coalesce(s.specifications, '[]'), coalesce(s.elements, '[]'), coalesce(s.source_hash, ''), now(), now()
    from src s
    on conflict (supplier_name, supplier_sku) do update set
      specifications = case when t.source_hash is distinct from excluded.source_hash then excluded.specifications else t.specifications end,
      elements = case when t.source_hash is distinct from excluded.source_hash then excluded.elements else t.elements end,
      scraped_at = case when t.source_hash is distinct from excluded.source_hash then now() else t.scraped_at end,
      source_hash = excluded.source_hash, checked_at = now()
    returning (xmax = 0) as inserted, (t.scraped_at = now()) as written
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted and written) into v_new, v_changed from up;
  return jsonb_build_object('rows', v_total, 'new', v_new, 'changed', v_changed, 'unchanged', v_total - v_new - v_changed);
end $$;

-- Afsluiten: artikelen uit de lijst die vannacht niet meer in de showroom stonden, worden inactief.
-- Bij minder dan p_min_expected artikelen gebeurt er niets (beveiliging tegen een halve run).
create or replace function finish_supplier_showroom_sync(p_supplier text, p_skus jsonb, p_min_expected int default 1000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seen int; v_gone int;
begin
  select count(*) into v_seen from jsonb_array_elements_text(p_skus);
  if v_seen < p_min_expected then
    raise exception 'Te weinig artikelen gevonden (%): niets op inactief gezet.', v_seen;
  end if;
  with gone as (
    update supplier_showroom_items set active = false, updated_at = now()
    where supplier_name = p_supplier and listed and active
      and supplier_sku not in (select jsonb_array_elements_text(p_skus))
    returning 1
  ) select count(*) into v_gone from gone;
  return jsonb_build_object('seen', v_seen, 'deactivated', v_gone);
end $$;

-- Welke productpagina's vannacht bekeken worden: eerst nieuwe artikelen, dan gewijzigde, dan de langst niet bekeken.
create or replace function showroom_details_todo(p_supplier text, p_limit int default 400)
returns table (supplier_sku text, product_url text)
language sql security definer set search_path = public as $$
  select i.supplier_sku, i.product_url
  from supplier_showroom_items i
  left join supplier_showroom_details d on d.supplier_name = i.supplier_name and d.supplier_sku = i.supplier_sku
  where i.supplier_name = p_supplier and i.listed and i.active and i.product_url <> ''
  order by (d.id is null) desc,
           (i.updated_at > coalesce(d.checked_at, d.scraped_at, '-infinity')) desc,
           coalesce(d.checked_at, d.scraped_at) asc nulls first
  limit greatest(p_limit, 0)
$$;

-- Alleen de servicesleutel (n8n) mag deze functies aanroepen.
do $$
declare f text;
begin
  foreach f in array array['sync_supplier_showroom_items(text, jsonb)', 'sync_supplier_showroom_elements(text, jsonb)',
    'sync_supplier_showroom_details(text, jsonb)', 'finish_supplier_showroom_sync(text, jsonb, int)', 'showroom_details_todo(text, int)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
