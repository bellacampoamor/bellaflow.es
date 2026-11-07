-- Nachtelijke sync: elke nacht een volledig bijgewerkte catalogus, met eigen artikelnummers.
--
-- 1. Een productpagina wordt opnieuw gelezen als de inhoud van het artikel in de lijst verandert (naam, EAN, serie,
--    categorie, prijs, foto, link). Een andere beschikbaarheidsdatum telt niet: die wisselt elke nacht en vulde
--    anders de wachtrij, waardoor specificaties en elementen achterbleven.
-- 2. showroom_details_todo geeft alle nieuwe en gewijzigde artikelen, plus p_limit artikelen in de rondgang,
--    met p_max als bovengrens. Vroeger was p_limit de grens voor alles samen.
-- 3. sync_catalog_articles(leverancier): eigen artikelnummers voor showroom en webshop, aan het eind van de sync.

alter table supplier_showroom_items
  add column if not exists content_hash text not null default '',
  add column if not exists content_changed_at timestamptz not null default '-infinity';

create or replace function sync_supplier_showroom_items(p_supplier text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int; v_changed int; v_total int;
begin
  select count(*) into v_total from jsonb_array_elements(p_rows);
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(supplier_sku text, product_id int, name text, ean text, series text, categories text,
      price numeric, available_date date, available_text text, image_url text, product_url text, source_hash text, content_hash text)
    where coalesce(r.supplier_sku, '') <> ''
  ), up as (
    insert into supplier_showroom_items as t (supplier_name, supplier_sku, product_id, name, ean, series, categories, price, currency,
      available_date, available_text, image_url, product_url, listed, active, source_hash, content_hash, content_changed_at, scraped_at, updated_at)
    select p_supplier, s.supplier_sku, s.product_id, coalesce(s.name, ''), coalesce(s.ean, ''), coalesce(s.series, ''), coalesce(s.categories, ''),
      s.price, 'EUR', s.available_date, coalesce(s.available_text, ''), coalesce(s.image_url, ''), coalesce(s.product_url, ''), true, true,
      coalesce(s.source_hash, ''), coalesce(s.content_hash, ''), now(), now(), now()
    from src s
    on conflict (supplier_name, supplier_sku) do update set
      product_id = excluded.product_id, name = excluded.name, ean = excluded.ean, series = excluded.series, categories = excluded.categories,
      price = excluded.price, available_date = excluded.available_date, available_text = excluded.available_text,
      image_url = excluded.image_url, product_url = excluded.product_url, listed = true, active = true,
      source_hash = excluded.source_hash,
      -- Zonder eerdere inhoudsvingerafdruk (eerste nacht na deze migratie) geldt het niet als wijziging.
      content_changed_at = case when t.content_hash <> '' and t.content_hash is distinct from excluded.content_hash then now() else t.content_changed_at end,
      content_hash = excluded.content_hash,
      scraped_at = now(), updated_at = now()
    where t.source_hash is distinct from excluded.source_hash or t.content_hash is distinct from excluded.content_hash or not t.active or not t.listed
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_new, v_changed from up;
  return jsonb_build_object('rows', v_total, 'new', v_new, 'changed', v_changed, 'unchanged', v_total - v_new - v_changed);
end $$;

drop function if exists showroom_details_todo(text, int);
create function showroom_details_todo(p_supplier text, p_limit int default 1000, p_max int default 3000)
returns table (supplier_sku text, product_url text, reason text)
language sql security definer set search_path = public as $$
  with c as (
    select i.supplier_sku, i.product_url,
      case when d.id is null then 'nieuw'
           when i.content_changed_at > coalesce(d.checked_at, d.scraped_at, '-infinity') then 'gewijzigd'
           else 'ronde' end as reason,
      coalesce(d.checked_at, d.scraped_at) as seen
    from supplier_showroom_items i
    left join supplier_showroom_details d on d.supplier_name = i.supplier_name and d.supplier_sku = i.supplier_sku
    where i.supplier_name = p_supplier and i.listed and i.active and i.product_url <> ''
  ), r as (
    select c.*, row_number() over (partition by c.reason = 'ronde' order by c.seen asc nulls first, c.supplier_sku) as rn from c
  )
  select r.supplier_sku, r.product_url, r.reason from r
  where r.reason <> 'ronde' or r.rn <= greatest(p_limit, 0)
  order by case r.reason when 'nieuw' then 0 when 'gewijzigd' then 1 else 2 end, r.seen asc nulls first, r.supplier_sku
  limit greatest(p_max, 0)
$$;

-- Eigen artikelnummers voor alles van deze leverancier: eerst de showroom (met elementen), dan wat alleen in de webshop staat.
create or replace function sync_catalog_articles(p_supplier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_res jsonb; v_sup uuid; v_code text; v_new int; v_upd int; v_first bigint;
begin
  select id, code into v_sup, v_code from suppliers where lower(trim(name)) = lower(trim(p_supplier));
  if v_sup is null then raise exception 'Leverancier % staat niet in suppliers.', p_supplier; end if;
  if v_code is null then
    raise exception 'Leverancier % heeft nog geen afkorting. Vul die in onder Beheer (of: update suppliers set code = ''LOL'' where name = ''%'').', p_supplier, p_supplier;
  end if;
  v_res := sync_catalog_articles_showroom(p_supplier);

  with u as (
    update catalog_articles a set name = c.name, price = nullif(coalesce(nullif(c.price_regular, 0), c.price_final), 0), currency = c.currency,
      image_url = coalesce(c.image_urls -> 0 ->> 'url', ''), active = c.active
    from supplier_catalog_items c
    where a.source = 'webshop' and a.supplier_id = v_sup and lower(trim(c.supplier_name)) = lower(trim(p_supplier))
      and lower(a.supplier_sku) = lower(c.supplier_sku)
      and (a.name, a.price, a.currency, a.image_url, a.active) is distinct from
          (c.name, nullif(coalesce(nullif(c.price_regular, 0), c.price_final), 0), c.currency, coalesce(c.image_urls -> 0 ->> 'url', ''), c.active)
    returning 1
  ) select count(*) into v_upd from u;

  drop table if exists pg_temp.new_webshop_articles;
  create temp table new_webshop_articles on commit drop as
    select c.supplier_sku, c.name, nullif(coalesce(nullif(c.price_regular, 0), c.price_final), 0) as price, c.currency,
      coalesce(c.image_urls -> 0 ->> 'url', '') as image_url, c.active,
      coalesce(
        (select k.code from article_categories k, jsonb_array_elements(c.categories) with ordinality as cat(v, n)
          where k.pattern is not null and (cat.v ->> 'name') ~* k.pattern order by cat.n, k.priority limit 1),
        (select k.code from article_categories k where k.pattern is not null and c.name ~* k.pattern order by k.priority limit 1),
        'OVR') as category_code
    from supplier_catalog_items c
    where lower(trim(c.supplier_name)) = lower(trim(p_supplier))
      and not exists (select 1 from catalog_articles a where a.supplier_id = v_sup and lower(a.supplier_sku) = lower(c.supplier_sku));
  select count(*) into v_new from new_webshop_articles;
  if v_new > 0 then
    v_first := reserve_article_numbers(v_new);
    insert into catalog_articles (article_number, supplier_id, supplier_sku, name, category_code, price, currency, image_url, source, active)
    select v_code || '-' || n.category_code || '-' || lpad((v_first + n.rn - 1)::text, 10, '0'), v_sup, n.supplier_sku, n.name, n.category_code,
      n.price, n.currency, n.image_url, 'webshop', n.active
    from (select *, row_number() over (order by supplier_sku) as rn from new_webshop_articles) n;
  end if;

  return jsonb_build_object('showroom', v_res, 'webshop', jsonb_build_object('new', v_new, 'changed', v_upd),
    'total', (select count(*) from catalog_articles where supplier_id = v_sup and active));
end $$;

do $$
declare f text;
begin
  foreach f in array array['sync_supplier_showroom_items(text, jsonb)', 'showroom_details_todo(text, int, int)', 'sync_catalog_articles(text)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
