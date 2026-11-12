-- HA-CO: series ruimer herkennen (12 november 2026, n.a.v. schermafdruk Rick met Bank Jop).
-- HA-CO schrijft dezelfde serie niet altijd hetzelfde:
--   "Bank Jop | Element Hoek", "Bank Jop. | Element Divan" en "Bank Jop. 1-zits bank" (zonder " | ") horen bij elkaar;
--   "Bank Jop Stripe 2 zits bank" hoort bij "Bank Jop Stripe | ...".
-- Regels:
-- 1. De serienaam is het deel vóór " | ", zonder hoofdletters, leestekens (. , ; :) en dubbele spaties.
-- 2. Een artikel zonder " | " hoort bij de langste serienaam waarmee zijn naam begint (gevolgd door een spatie),
--    behalve een verzamelartikel met modellen in de webwinkel (zoals Hjort Knudsen Portland).
-- 3. Een artikel in een serie krijgt geen modellen uit de webwinkel; heeft het meerdere webwinkelpagina's (bijv. Bank Jop
--    0035515 met "Loungebank Jop" in twee kleuren), dan krijgt het de foto's van de eerste pagina.
-- 4. Het serie-artikel heet naar de meest gebruikte schrijfwijze, zonder punt aan het eind.

create or replace function haco_norm(p text) returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[.,;:]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

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
  create index on haco_web (base_sku);

  drop table if exists pg_temp.haco_mos;
  create temp table haco_mos on commit drop as
    select i.supplier_sku, i.ean, i.name, i.variant, i.manufacturer_name, i.price, i.currency, i.active, i.categories,
      coalesce((select jsonb_agg(d->>'url') from jsonb_array_elements(i.documents) d
        where (d->>'url') ~* '[.](jpe?g|png|gif|webp)$'), '[]'::jsonb) as mos_images,
      position('|' in i.name) > 0 as has_pipe,
      case when position('|' in i.name) > 0 then nullif(haco_norm(split_part(i.name, '|', 1)), '') end as fam_key,
      regexp_replace(trim(split_part(i.name, '|', 1)), '[\s.,;:]+$', '') as fam_display,
      haco_norm(i.name) as norm_name,
      exists (select 1 from haco_web w where w.base_sku = i.supplier_sku and w.n > 1) as has_models,
      null::text as fam
    from supplier_haco_items i where i.supplier_name = p_supplier and i.listed;
  create index on haco_mos (supplier_sku);
  create index on haco_mos (lower(supplier_sku));

  -- Series: eerst op het deel vóór " | ", daarna artikelen zonder " | " op de langste serienaam waarmee ze beginnen.
  update haco_mos set fam = fam_key where active and fam_key is not null;
  update haco_mos m set fam = (
      select k.fam from (select distinct fam from haco_mos where fam is not null) k
      where left(m.norm_name, length(k.fam) + 1) = k.fam || ' ' order by length(k.fam) desc limit 1)
  where m.active and not m.has_pipe and not m.has_models;
  drop table if exists pg_temp.haco_fam;
  create temp table haco_fam on commit drop as
    select fam, count(*) as n,
      coalesce(mode() within group (order by fam_display) filter (where has_pipe), min(fam_display)) as display,
      min(manufacturer_name) as series, min(currency) as currency, min(categories) as categories
    from haco_mos where fam is not null group by fam having count(*) > 1;
  update haco_mos m set fam = null where m.fam is not null and not exists (select 1 from haco_fam f where f.fam = m.fam);

  drop table if exists pg_temp.haco_src;
  create temp table haco_src on commit drop as
  select m.supplier_sku, m.ean,
    left(trim(m.name || case when m.variant <> '' then ' - ' || m.variant else '' end), 300) as name,
    m.manufacturer_name as series, coalesce(m.price, 0) as price, m.currency, m.active, m.categories,
    -- Foto's van de webwinkel: bij één pagina die pagina; in een serie ook de eerste van meerdere pagina's.
    m.mos_images || coalesce((select w.images from haco_web w where w.base_sku = m.supplier_sku and (w.n = 1 or m.fam is not null)
      order by w.url_key limit 1), '[]'::jsonb) as images,
    false as is_model, null::text as base_sku,
    case when m.fam is not null then (select 'SERIE ' || f.display from haco_fam f where f.fam = m.fam) end as parent_sku,
    false as is_family
  from haco_mos m
  union all
  -- Modellen van een verzamelartikel (niet als dat artikel in een serie zit). Gelijke namen krijgen hun modelnummer erachter.
  select mm.sku, mm.ean,
    left(case when count(*) over (partition by mm.base_sku, lower(mm.nm)) > 1
      then mm.nm || ' (' || coalesce(nullif(regexp_replace(mm.sku, '^[CV]-?[0-9]+[-_]', ''), mm.sku), mm.sku) || ')' else mm.nm end, 300),
    mm.series, mm.price, mm.currency, mm.active, mm.categories, mm.images, true, mm.base_sku, mm.base_sku, false
  from (
    select distinct on (upper(w.web_sku)) upper(w.web_sku) as sku, ''::text as ean,
      trim(coalesce(nullif(w.web_name, ''), nullif(w.title, ''), b.name)) as nm,
      b.manufacturer_name as series, coalesce(b.price, 0) as price, b.currency, b.active, b.categories, w.images, w.base_sku
    from haco_web w join haco_mos b on b.supplier_sku = w.base_sku
    where w.n > 1 and w.web_sku <> '' and b.fam is null
      and not exists (select 1 from haco_mos x where lower(x.supplier_sku) = lower(w.web_sku))
    order by upper(w.web_sku), w.url_key
  ) mm
  union all
  -- Het serie-artikel: geen prijs, niet zelf te bestellen.
  select 'SERIE ' || f.display, '', left(f.display, 300), f.series, null, f.currency, true, f.categories, '[]'::jsonb,
    false, null, null, true
  from haco_fam f;

  alter table haco_src add column image_url text;
  update haco_src set image_url = coalesce(images->>0, '') where true; -- 'where true': PostgREST staat geen UPDATE zonder WHERE toe
  -- Een verzamelartikel of serie zonder eigen foto toont in de lijst de foto van zijn eerste uitvoering met foto.
  update haco_src p set image_url = v.images->>0
  from (select distinct on (lower(parent_sku)) lower(parent_sku) as psku, images from haco_src
        where parent_sku is not null and jsonb_array_length(images) > 0 order by lower(parent_sku), supplier_sku) v
  where p.parent_sku is null and p.image_url = '' and v.psku = lower(p.supplier_sku);
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

  -- Varianten: elk model hoort bij zijn verzamelartikel, elke uitvoering bij zijn serie.
  update catalog_articles a set variant_of = p.id
  from haco_src s join catalog_articles p on p.supplier_id = v_sup and lower(p.supplier_sku) = lower(s.parent_sku)
  where s.parent_sku is not null and a.supplier_id = v_sup and lower(a.supplier_sku) = lower(s.supplier_sku) and a.variant_of is distinct from p.id;
  update catalog_articles a set variant_of = null
  where a.supplier_id = v_sup and a.source = 'haco' and a.variant_of is not null
    and not exists (select 1 from haco_src s where s.parent_sku is not null and lower(s.supplier_sku) = lower(a.supplier_sku));

  with o as (
    update catalog_articles a set active = false
    where a.supplier_id = v_sup and a.source = 'haco' and a.active
      and not exists (select 1 from haco_src s where lower(s.supplier_sku) = lower(a.supplier_sku))
    returning 1
  ) select count(*) into v_off from o;

  return jsonb_build_object('new', v_new, 'changed', v_upd, 'deactivated', v_off,
    'models', (select count(*) from haco_src where is_model),
    'series', (select count(*) from haco_src where is_family),
    'in_series', (select count(*) from haco_src where parent_sku is not null and not is_model),
    'with_photo', (select count(*) from haco_src where image_url <> ''));
end $$;

alter function sync_catalog_articles_haco(text) set statement_timeout = '120s';

do $$
declare f text;
begin
  foreach f in array array['sync_catalog_articles_haco(text)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
