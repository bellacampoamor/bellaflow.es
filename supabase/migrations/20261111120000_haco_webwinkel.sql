-- HA-CO: foto's en modellen uit de webwinkel haco.nu (opdracht Rick 11 november 2026).
--
-- Het bestelportaal (MOS) heeft maar voor ~6% van de artikelen een foto. De webwinkel heeft er voor bijna alles een,
-- en elke productpagina draagt het artikelnummer uit MOS in het adres:
--   haco.nu/0027920-eetkamerstoel-diamond          -> artikel 0027920 (één pagina, één artikel)
--   haco.nu/c0002631-2108-15-nachtkastje-flat-xs   -> verzamelartikel 0002631 "Zijlstra serie", model 2108-15
-- Een verzamelartikel is in MOS één commissieartikel voor een hele collectie; het model vul je pas op de bestelregel in.
-- De webwinkel heeft per model een eigen pagina. Elk model wordt daarom een eigen catalogusartikel, met als
-- artikelnummer leverancier het webwinkelnummer (bijv. C0002631-2108-15), zodat HA-CO verzamelartikel en model herkent.
--
-- De n8n-flow "BellaFlow: HA-CO webwinkel sync" leest elke nacht de sitemap (adres, foto's, wijzigingsdatum) en alleen de
-- productpagina's van modellen die nieuw of gewijzigd zijn (voor het webwinkelnummer). Daarna sync_catalog_articles_haco.
-- Voorrang bij foto's: eerst de foto's uit MOS, daarna die van de webwinkel. Alle foto's staan in catalog_articles.images.

alter table catalog_articles add column if not exists images jsonb not null default '[]'::jsonb;

alter table catalog_articles drop constraint if exists catalog_articles_source_check;
alter table catalog_articles add constraint catalog_articles_source_check
  check (source in ('showroom', 'webshop', 'haco', 'hdb', 'suns'));

create table if not exists supplier_haco_web_items (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  url_key text not null,                         -- laatste deel van het adres, bijv. c0002631-2108-15-nachtkastje-flat-xs
  url text not null,
  base_sku text not null,                        -- artikelnummer in MOS, 7 cijfers
  prefix text not null default '',               -- '' los artikel, 'c' of 'v' samenstelbaar of verzameld
  title text not null default '',                -- naam bij de foto's in de sitemap
  images jsonb not null default '[]'::jsonb,     -- adressen van de foto's, in de volgorde van de webwinkel
  lastmod timestamptz,                           -- wijzigingsdatum volgens de sitemap
  listed boolean not null default true,          -- stond in de laatste sitemap
  web_sku text not null default '',              -- nummer op de productpagina, bijv. C0002631-2108-15
  web_name text not null default '',
  web_price numeric(12, 2),                      -- consumentenprijs in de webwinkel (alleen ter informatie)
  page_lastmod timestamptz,                      -- lastmod toen de pagina gelezen werd
  page_tried_at timestamptz,
  page_error text not null default '',
  seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_name, url_key)
);
create index if not exists supplier_haco_web_items_base on supplier_haco_web_items (supplier_name, base_sku);
alter table supplier_haco_web_items enable row level security;
drop policy if exists team_all on supplier_haco_web_items;
create policy team_all on supplier_haco_web_items for all to authenticated
  using ((select is_team_member())) with check ((select is_team_member()));

create table if not exists supplier_haco_web_state (
  supplier_name text primary key,
  cycle_date date,
  sitemap_at timestamptz,
  finished_at timestamptz,
  last_run_at timestamptz,
  last_result jsonb not null default '{}'::jsonb
);
alter table supplier_haco_web_state enable row level security;
drop policy if exists team_all on supplier_haco_web_state;
create policy team_all on supplier_haco_web_state for all to authenticated
  using ((select is_team_member())) with check ((select is_team_member()));

-- Pagina's met een model: meerdere webwinkelpagina's op hetzelfde artikelnummer uit MOS.
create or replace function haco_web_models(p_supplier text)
returns table (url_key text, base_sku text) language sql stable set search_path = public as $$
  select w.url_key, w.base_sku from supplier_haco_web_items w
  where w.supplier_name = p_supplier and w.listed
    and (select count(*) from supplier_haco_web_items x where x.supplier_name = p_supplier and x.listed and x.base_sku = w.base_sku) > 1
$$;

-- Wat de n8n-flow nu moet doen: sitemap lezen, een reeks productpagina's lezen, de catalogus bijwerken, of niets.
create or replace function claim_supplier_haco_web_sync(p_supplier text, p_batch integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s supplier_haco_web_state; v_today date := (now() at time zone 'Europe/Madrid')::date; v_urls jsonb;
begin
  insert into supplier_haco_web_state (supplier_name) values (p_supplier) on conflict do nothing;
  select * into s from supplier_haco_web_state where supplier_name = p_supplier for update;
  if s.cycle_date is distinct from v_today then
    update supplier_haco_web_state set cycle_date = v_today, sitemap_at = null, finished_at = null
    where supplier_name = p_supplier returning * into s;
  end if;
  update supplier_haco_web_state set last_run_at = now() where supplier_name = p_supplier;
  if s.finished_at is not null then
    return jsonb_build_object('action', 'done', 'cycle_date', s.cycle_date, 'finished_at', s.finished_at);
  end if;
  if s.sitemap_at is null then
    return jsonb_build_object('action', 'sitemap');
  end if;
  -- Productpagina's van modellen die nieuw of gewijzigd zijn; elke pagina hoogstens één poging per dag.
  select coalesce(jsonb_agg(jsonb_build_object('url_key', q.url_key, 'url', q.url)), '[]'::jsonb) into v_urls
  from (
    select w.url_key, w.url from supplier_haco_web_items w join haco_web_models(p_supplier) m on m.url_key = w.url_key
    where w.supplier_name = p_supplier
      and (w.web_sku = '' or w.page_lastmod is distinct from w.lastmod)
      and (w.page_tried_at is null or w.page_tried_at < s.sitemap_at)
    order by w.page_tried_at nulls first, w.url_key
    limit greatest(p_batch, 1)
  ) q;
  if jsonb_array_length(v_urls) > 0 then
    return jsonb_build_object('action', 'pages', 'urls', v_urls);
  end if;
  return jsonb_build_object('action', 'catalog');
end $$;

-- Verwerkt wat de n8n-flow las.
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
        web_sku = case when coalesce(s.error, '') = '' and coalesce(s.web_sku, '') <> '' then upper(trim(s.web_sku)) else w.web_sku end,
        web_name = case when coalesce(s.error, '') = '' and coalesce(s.web_name, '') <> '' then left(trim(s.web_name), 300) else w.web_name end,
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

-- Catalogusartikelen van HA-CO: de artikelen uit MOS, aangevuld met de foto's en modellen uit de webwinkel.
create or replace function sync_catalog_articles_haco(p_supplier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_code text; v_new int; v_upd int; v_off int; v_first bigint;
begin
  select id, code into v_sup, v_code from suppliers where lower(trim(name)) = lower(trim(p_supplier));
  if v_sup is null then raise exception 'Leverancier % staat niet onder Beheer.', p_supplier; end if;
  if v_code is null then raise exception 'Leverancier % heeft nog geen afkorting. Vul die in onder Beheer.', p_supplier; end if;

  drop table if exists pg_temp.haco_src;
  create temp table haco_src on commit drop as
  with web as (
    select w.* from supplier_haco_web_items w where w.supplier_name = p_supplier and w.listed
  ), models as (
    select w.* from web w join haco_web_models(p_supplier) m on m.url_key = w.url_key
  ), single as (
    -- Een artikel met precies één webwinkelpagina krijgt de foto's van die pagina.
    select w.base_sku, w.images from web w where not exists (select 1 from models m where m.url_key = w.url_key)
  ), mos as (
    select i.*,
      coalesce((select jsonb_agg(d->>'url') from jsonb_array_elements(i.documents) d
        where (d->>'url') ~* '[.](jpe?g|png|gif|webp)$'), '[]'::jsonb) as mos_images
    from supplier_haco_items i where i.supplier_name = p_supplier and i.listed
  )
  select m.supplier_sku, m.ean,
    left(trim(m.name || case when m.variant <> '' then ' - ' || m.variant else '' end), 300) as name,
    m.manufacturer_name as series, coalesce(m.price, 0) as price, m.currency, m.active, m.categories,
    m.mos_images || coalesce((select s.images from single s where s.base_sku = m.supplier_sku limit 1), '[]'::jsonb) as images,
    false as is_model
  from mos m
  union all
  -- Modellen van een verzamelartikel: eigen artikel, met naam en foto's uit de webwinkel en verder de gegevens uit MOS.
  select * from (
    select distinct on (upper(w.web_sku)) upper(w.web_sku), '',
      left(trim(coalesce(nullif(w.web_name, ''), nullif(w.title, ''), b.name)), 300),
      b.manufacturer_name, coalesce(b.price, 0), b.currency, b.active, b.categories, w.images, true
    from models w join mos b on b.supplier_sku = w.base_sku
    where w.web_sku <> ''
      and not exists (select 1 from mos x where lower(x.supplier_sku) = lower(w.web_sku))
    order by upper(w.web_sku), w.url_key
  ) mm;

  alter table haco_src add column image_url text;
  update haco_src set image_url = coalesce(images->>0, '');

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

-- Alleen voor de n8n-flow (service_role), net als de andere sync-functies.
do $$
declare f text;
begin
  foreach f in array array['claim_supplier_haco_web_sync(text, integer)', 'apply_supplier_haco_web_sync(text, jsonb)',
    'sync_catalog_articles_haco(text)', 'haco_web_models(text)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
