-- HA-CO webwinkel, 12 november 2026 (opdracht Rick):
-- 1. Varianten met dezelfde naam binnen een verzamelartikel krijgen hun modelnummer achter de naam.
-- 2. Een productpagina die niet meer bestaat of doorstuurt naar een ander product (haco.nu doet dat bij producten
--    die uit de webwinkel zijn) levert geen model meer op. Eerder gaf zo'n pagina de gegevens van het andere product.
-- 3. Alle modelpagina's worden de eerstvolgende run opnieuw gelezen, om die fout recht te zetten.

create or replace function apply_supplier_haco_web_sync(p_supplier text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind text := p_payload->>'kind'; v_rows jsonb := coalesce(p_payload->'rows', '[]'::jsonb);
  v_total int; v_new int; v_changed int; v_gone int; v_res jsonb;
begin
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'rows moet een JSON-array zijn'; end if;
  select count(*) into v_total from jsonb_array_elements(v_rows);

  if v_kind = 'sitemap' then
    -- Een halve of lege sitemap mag de catalogus niet leegmaken.
    if v_total < coalesce((p_payload->>'min_expected')::int, 1000) then
      raise exception 'Sitemap van haco.nu gaf maar % productpagina''s; niets bijgewerkt.', v_total;
    end if;
    with src as (
      select distinct on (r.url_key) r.* from jsonb_to_recordset(v_rows)
        as r(url_key text, url text, base_sku text, prefix text, title text, images jsonb, lastmod timestamptz)
      where coalesce(r.url_key, '') <> '' and r.base_sku ~ '^[0-9]{7}$'
      order by r.url_key
    ), up as (
      insert into supplier_haco_web_items as t (supplier_name, url_key, url, base_sku, prefix, title, images, lastmod, listed, seen_at, updated_at)
      select p_supplier, s.url_key, s.url, s.base_sku, coalesce(s.prefix, ''), coalesce(s.title, ''), coalesce(s.images, '[]'), s.lastmod, true, now(), now()
      from src s
      on conflict (supplier_name, url_key) do update set url = excluded.url, base_sku = excluded.base_sku, prefix = excluded.prefix,
        title = excluded.title, images = excluded.images, lastmod = excluded.lastmod, listed = true, seen_at = now(),
        updated_at = case when (t.images, t.title, t.lastmod, t.listed) is distinct from (excluded.images, excluded.title, excluded.lastmod, true)
          then now() else t.updated_at end
      returning (xmax = 0) as inserted, (t.updated_at = now()) as changed
    ) select count(*) filter (where inserted), count(*) filter (where not inserted and changed) into v_new, v_changed from up;
    with g as (
      update supplier_haco_web_items set listed = false, updated_at = now()
      where supplier_name = p_supplier and listed
        and url_key not in (select x->>'url_key' from jsonb_array_elements(v_rows) x where x->>'url_key' is not null)
      returning 1
    ) select count(*) into v_gone from g;
    v_res := jsonb_build_object('kind', 'sitemap', 'total', v_total, 'new', v_new, 'changed', v_changed, 'gone', v_gone);
    update supplier_haco_web_state set sitemap_at = now(), last_result = v_res where supplier_name = p_supplier;
    return v_res;

  elsif v_kind = 'pages' then
    with src as (
      select r.* from jsonb_to_recordset(v_rows) as r(url_key text, web_sku text, web_name text, web_price numeric, error text)
    ), up as (
      update supplier_haco_web_items w set
        -- Bestaat de pagina niet meer of stuurt hij door naar een ander product, dan ook geen model meer.
        web_sku = case when coalesce(s.error, '') = '' and coalesce(s.web_sku, '') <> '' then upper(trim(s.web_sku))
          when s.error ~ '^(HTTP 404|HTTP 410|doorgestuurd)' then '' else w.web_sku end,
        web_name = case when coalesce(s.error, '') = '' and coalesce(s.web_name, '') <> '' then left(trim(s.web_name), 300)
          when s.error ~ '^(HTTP 404|HTTP 410|doorgestuurd)' then '' else w.web_name end,
        web_price = case when coalesce(s.error, '') = '' then s.web_price else w.web_price end,
        page_lastmod = case when coalesce(s.error, '') = '' and coalesce(s.web_sku, '') <> '' then w.lastmod else w.page_lastmod end,
        page_error = coalesce(s.error, ''), page_tried_at = now(), updated_at = now()
      from src s where w.supplier_name = p_supplier and w.url_key = s.url_key
      returning (coalesce(s.error, '') = '' and coalesce(s.web_sku, '') <> '') as ok
    ) select count(*) filter (where ok), count(*) filter (where not ok) into v_new, v_gone from up;
    v_res := jsonb_build_object('kind', 'pages', 'total', v_total, 'read', v_new, 'failed', v_gone);
    update supplier_haco_web_state set last_result = v_res where supplier_name = p_supplier;
    return v_res;

  elsif v_kind = 'catalog' then
    v_res := jsonb_build_object('kind', 'catalog', 'catalog', sync_catalog_articles_haco(p_supplier),
      'pages_failed', (select count(*) from supplier_haco_web_items where supplier_name = p_supplier and listed and page_error <> ''));
    update supplier_haco_web_state set finished_at = now(), last_result = v_res where supplier_name = p_supplier;
    return v_res;
  end if;
  raise exception 'Onbekende soort sync-resultaat: %', v_kind;
end $$;

create or replace function sync_catalog_articles_haco(p_supplier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_code text; v_new int; v_upd int; v_off int; v_first bigint;
begin
  select id, code into v_sup, v_code from suppliers where lower(trim(name)) = lower(trim(p_supplier));
  if v_sup is null then raise exception 'Leverancier % staat niet onder Beheer.', p_supplier; end if;
  if v_code is null then raise exception 'Leverancier % heeft nog geen afkorting. Vul die in onder Beheer.', p_supplier; end if;

  drop table if exists pg_temp.haco_web;
  create temp table haco_web on commit drop as
    select w.url_key, w.base_sku, w.title, w.images, w.web_sku, w.web_name, count(*) over (partition by w.base_sku) as n
    from supplier_haco_web_items w where w.supplier_name = p_supplier and w.listed;

  drop table if exists pg_temp.haco_mos;
  create temp table haco_mos on commit drop as
    select i.supplier_sku, i.ean, i.name, i.variant, i.manufacturer_name, i.price, i.currency, i.active, i.categories,
      coalesce((select jsonb_agg(d->>'url') from jsonb_array_elements(i.documents) d
        where (d->>'url') ~* '[.](jpe?g|png|gif|webp)$'), '[]'::jsonb) as mos_images
    from supplier_haco_items i where i.supplier_name = p_supplier and i.listed;
  create index on haco_mos (supplier_sku);
  create index on haco_mos (lower(supplier_sku));

  drop table if exists pg_temp.haco_src;
  create temp table haco_src on commit drop as
  select m.supplier_sku, m.ean,
    left(trim(m.name || case when m.variant <> '' then ' - ' || m.variant else '' end), 300) as name,
    m.manufacturer_name as series, coalesce(m.price, 0) as price, m.currency, m.active, m.categories,
    m.mos_images || coalesce(s.images, '[]'::jsonb) as images, false as is_model, null::text as base_sku
  from haco_mos m
  left join (select distinct on (base_sku) base_sku, images from haco_web where n = 1 order by base_sku, url_key) s on s.base_sku = m.supplier_sku
  union all
  -- Varianten met dezelfde naam binnen een verzamelartikel krijgen hun modelnummer erachter, bijv. "Tafellamp Soll 1L (6001-43)".
  select mm.sku, mm.ean,
    left(case when count(*) over (partition by mm.base_sku, lower(mm.nm)) > 1
      then mm.nm || ' (' || coalesce(nullif(regexp_replace(mm.sku, '^[CV]-?[0-9]+[-_]', ''), mm.sku), mm.sku) || ')' else mm.nm end, 300),
    mm.series, mm.price, mm.currency, mm.active, mm.categories, mm.images, true, mm.base_sku
  from (
    select distinct on (upper(w.web_sku)) upper(w.web_sku) as sku, ''::text as ean,
      trim(coalesce(nullif(w.web_name, ''), nullif(w.title, ''), b.name)) as nm,
      b.manufacturer_name as series, coalesce(b.price, 0) as price, b.currency, b.active, b.categories, w.images, w.base_sku
    from haco_web w join haco_mos b on b.supplier_sku = w.base_sku
    where w.n > 1 and w.web_sku <> ''
      and not exists (select 1 from haco_mos x where lower(x.supplier_sku) = lower(w.web_sku))
    order by upper(w.web_sku), w.url_key
  ) mm;
  alter table haco_src add column image_url text;
  update haco_src set image_url = coalesce(images->>0, '') where true; -- 'where true': PostgREST staat geen UPDATE zonder WHERE toe
  -- Een verzamelartikel zonder eigen foto toont in de lijst de foto van zijn eerste variant.
  update haco_src p set image_url = v.images->>0
  from (select distinct on (base_sku) base_sku, images from haco_src where is_model and jsonb_array_length(images) > 0 order by base_sku, supplier_sku) v
  where not p.is_model and p.image_url = '' and v.base_sku = p.supplier_sku;
  create index on haco_src (lower(supplier_sku));

  with u as (
    update catalog_articles a set ean = s.ean, name = s.name, series = s.series, price = s.price, currency = s.currency,
      image_url = s.image_url, images = s.images, source = 'haco', active = s.active
    from haco_src s
    where a.supplier_id = v_sup and lower(a.supplier_sku) = lower(s.supplier_sku)
      and (a.ean, a.name, a.series, a.price, a.currency, a.image_url, a.images, a.source, a.active)
        is distinct from (s.ean, s.name, s.series, s.price, s.currency, s.image_url, s.images, 'haco', s.active)
    returning 1
  ) select count(*) into v_upd from u;

  drop table if exists pg_temp.haco_new;
  create temp table haco_new on commit drop as
    -- Een model kiest eerst op zijn eigen naam (de omzetgroep van een verzamelartikel is te algemeen).
    select s.*, coalesce(
        case when s.is_model then (select c.code from article_categories c where c.pattern is not null and s.name ~* c.pattern order by c.priority limit 1) end,
        (select c.code from article_categories c where c.pattern is not null and s.categories ~* c.pattern order by c.priority limit 1),
        (select c.code from article_categories c where c.pattern is not null and s.name ~* c.pattern order by c.priority limit 1),
        'OVR') as category_code
    from haco_src s
    where not exists (select 1 from catalog_articles a where a.supplier_id = v_sup and lower(a.supplier_sku) = lower(s.supplier_sku));

  select count(*) into v_new from haco_new;
  if v_new > 0 then
    v_first := reserve_article_numbers(v_new);
    insert into catalog_articles (article_number, supplier_id, supplier_sku, ean, name, category_code, series, price, currency, image_url, images, source, active)
    select v_code || '-' || n.category_code || '-' || lpad((v_first + n.rn - 1)::text, 10, '0'), v_sup, n.supplier_sku, n.ean, n.name,
      n.category_code, n.series, n.price, n.currency, n.image_url, n.images, 'haco', n.active
    from (select *, row_number() over (order by supplier_sku) as rn from haco_new) n;
  end if;

  -- Varianten: elk model hoort bij zijn verzamelartikel.
  update catalog_articles a set variant_of = p.id
  from haco_src s join catalog_articles p on p.supplier_id = v_sup and p.supplier_sku = s.base_sku
  where s.is_model and a.supplier_id = v_sup and lower(a.supplier_sku) = lower(s.supplier_sku) and a.variant_of is distinct from p.id;
  update catalog_articles a set variant_of = null
  where a.supplier_id = v_sup and a.source = 'haco' and a.variant_of is not null
    and not exists (select 1 from haco_src s where s.is_model and lower(s.supplier_sku) = lower(a.supplier_sku));

  with o as (
    update catalog_articles a set active = false
    where a.supplier_id = v_sup and a.source = 'haco' and a.active
      and not exists (select 1 from haco_src s where lower(s.supplier_sku) = lower(a.supplier_sku))
    returning 1
  ) select count(*) into v_off from o;

  return jsonb_build_object('new', v_new, 'changed', v_upd, 'deactivated', v_off,
    'models', (select count(*) from haco_src where is_model),
    'with_photo', (select count(*) from haco_src where image_url <> ''));
end $$;

alter function sync_catalog_articles_haco(text) set statement_timeout = '120s';
alter function apply_supplier_haco_web_sync(text, jsonb) set statement_timeout = '120s';

do $$
declare f text;
begin
  foreach f in array array['apply_supplier_haco_web_sync(text, jsonb)', 'sync_catalog_articles_haco(text)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

-- Alle modelpagina's opnieuw laten lezen (het webwinkelnummer blijft staan tot de pagina opnieuw gelezen is).
update supplier_haco_web_items set page_lastmod = null, page_tried_at = null where web_sku <> '' or page_error <> '';
update supplier_haco_web_state set finished_at = null where finished_at is not null;
