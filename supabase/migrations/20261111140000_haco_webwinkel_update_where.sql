-- HA-CO webwinkel: catalogusstap faalde via n8n met "UPDATE requires a WHERE clause" (11 november 2026).
-- Supabase blokkeert via PostgREST elke UPDATE zonder WHERE (pg_safeupdate), ook op een tijdelijke tabel binnen een functie.
-- Alleen die ene regel krijgt "where true"; verder gelijk aan 20261111130000_haco_webwinkel_sneller.sql.

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
    m.mos_images || coalesce(s.images, '[]'::jsonb) as images, false as is_model
  from haco_mos m
  left join (select distinct on (base_sku) base_sku, images from haco_web where n = 1 order by base_sku, url_key) s on s.base_sku = m.supplier_sku
  union all
  select * from (
    select distinct on (upper(w.web_sku)) upper(w.web_sku), '',
      left(trim(coalesce(nullif(w.web_name, ''), nullif(w.title, ''), b.name)), 300),
      b.manufacturer_name, coalesce(b.price, 0), b.currency, b.active, b.categories, w.images, true
    from haco_web w join haco_mos b on b.supplier_sku = w.base_sku
    where w.n > 1 and w.web_sku <> ''
      and not exists (select 1 from haco_mos x where lower(x.supplier_sku) = lower(w.web_sku))
    order by upper(w.web_sku), w.url_key
  ) mm;
  alter table haco_src add column image_url text;
  update haco_src set image_url = coalesce(images->>0, '') where true; -- 'where true': PostgREST staat geen UPDATE zonder WHERE toe
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

do $$
begin
  execute 'revoke execute on function sync_catalog_articles_haco(text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function sync_catalog_articles_haco(text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function sync_catalog_articles_haco(text) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function sync_catalog_articles_haco(text) to service_role'; end if;
end $$;
