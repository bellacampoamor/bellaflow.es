-- Eigen artikelnummers voor alle artikelen uit de catalogi van alle leveranciers, inclusief elementen (subartikelen).
-- Opbouw: LLL-CCC-0000000000 = afkorting leverancier, afkorting productcategorie, tiencijferig volgnummer.
-- Het volgnummer is uniek over alle leveranciers. Een toegekend nummer wijzigt nooit, ook niet als de categorie later anders is.
-- De bronnen (supplier_catalog_items, supplier_showroom_items, supplier_showroom_details) blijven ongewijzigd;
-- de app vult catalog_articles daaruit bij het inlezen (syncCatalogArticles in src/domain/articles.ts).

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Afkorting van de leverancier, de eerste drie letters van het artikelnummer.
alter table suppliers add column code text unique check (code is null or code ~ '^[A-Z]{3}$');

-- Eigen productcategorieën met hun afkorting. pattern herkent de categorie van de leverancier of de naam; de laagste
-- priority die past wint. Gelijk aan ARTICLE_CATEGORIES in src/domain/articles.ts (een test bewaakt dat).
create table article_categories (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  priority integer not null,
  pattern text
);
insert into article_categories (code, name, priority, pattern) values
  ('HOE', 'Hoezen en onderhoud', 10, 'hoes|hoezen|onderhoud|reinig'),
  ('KUS', 'Kussens', 20, 'kussen'),
  ('PAR', 'Parasols en gazebo''s', 30, 'parasol|gazebo|schaduwdoek|paviljoen'),
  ('VER', 'Verlichting', 40, 'lamp|verlichting|lantaarn|\mled\M'),
  ('LIG', 'Ligbedden', 50, 'ligbed|lounger|daybed'),
  ('POF', 'Voetenbanken en poefs', 60, 'voetenbank|poef|hocker|footstool'),
  ('LOU', 'Loungesets en loungemeubels', 70, 'lounge|hoekbank|hoekelement|tussendel|middenelement|chaise'),
  ('TSE', 'Tuinsets', 80, 'tuinset|diningset|dining set|balkonset|barset|bistroset'),
  ('STO', 'Stoelen', 90, 'stoel|fauteuil|kruk|chair'),
  ('TAF', 'Tafels', 100, 'tafel|table'),
  ('BNK', 'Banken', 110, 'bank|bench|sofa'),
  ('ACC', 'Accessoires', 120, 'accessoire|plaid|vloerkleed|bloempot|plantenbak'),
  ('OVR', 'Overig', 999, null);

create sequence catalog_article_seq minvalue 1 maxvalue 9999999999 no cycle;

create table catalog_articles (
  id uuid primary key default gen_random_uuid(),
  article_number text not null unique check (article_number ~ '^[A-Z]{3}-[A-Z]{3}-[0-9]{10}$'),
  supplier_id uuid not null references suppliers (id),
  supplier_sku text not null,
  ean text not null default '',
  name text not null,
  category_code text not null references article_categories (code),
  series text not null default '',
  price numeric(12, 2),
  currency text not null default 'EUR',
  image_url text not null default '',
  source text not null check (source in ('showroom', 'webshop')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  search_text text generated always as (lower(article_number || ' ' || supplier_sku || ' ' || ean || ' ' || name || ' ' || series)) stored,
  unique (supplier_id, supplier_sku)
);
create index catalog_articles_search on catalog_articles using gin (search_text extensions.gin_trgm_ops);
create index catalog_articles_supplier on catalog_articles (supplier_id);

-- Een artikelnummer staat vast zodra het is toegekend.
create function catalog_article_number_fixed() returns trigger language plpgsql as $$
begin
  if new.article_number is distinct from old.article_number or new.supplier_id is distinct from old.supplier_id or new.supplier_sku is distinct from old.supplier_sku then
    raise exception 'Een artikelnummer, leverancier en artikelnummer van de leverancier wijzigen niet.';
  end if;
  return new;
end $$;
create trigger catalog_articles_fixed before update on catalog_articles for each row execute function catalog_article_number_fixed();

-- Artikel en elementen: welke artikelen bij een set of artikel besteld kunnen worden, in de volgorde van de leverancier.
-- Op de eigen id's, dus de koppeling blijft bestaan als de leverancier zijn lijst wijzigt. Inlezen voegt alleen toe.
create table catalog_article_elements (
  parent_id uuid not null references catalog_articles (id),
  element_id uuid not null references catalog_articles (id),
  position integer not null default 0,
  primary key (parent_id, element_id),
  check (parent_id <> element_id)
);
create index catalog_article_elements_element on catalog_article_elements (element_id);

-- Een product onder Beheer dat uit de catalogus komt, draagt het eigen artikelnummer.
alter table products add column catalog_article_number text unique references catalog_articles (article_number);

-- Reserveert een blok volgnummers in één keer, zodat twee mensen die tegelijk inlezen nooit hetzelfde nummer krijgen.
create function reserve_article_numbers(p_count integer) returns bigint language plpgsql as $$
declare v_first bigint;
begin
  if p_count < 1 then raise exception 'Aantal moet minstens 1 zijn.'; end if;
  perform pg_advisory_xact_lock(hashtext('catalog_article_seq'));
  v_first := nextval('catalog_article_seq');
  if p_count > 1 then perform setval('catalog_article_seq', v_first + p_count - 1); end if;
  return v_first;
end $$;

-- Zoeken over alle catalogi tegelijk, of alleen de gekozen leveranciers. Alle woorden moeten voorkomen in
-- eigen artikelnummer, artikelnummer van de leverancier, EAN, naam of serie. Het langste woord gebruikt de trigram-index.
create function search_catalog_articles(p_q text, p_suppliers uuid[] default null, p_limit integer default 30)
returns table (
  id uuid, article_number text, supplier_id uuid, supplier_sku text, ean text, name text, category_code text, series text,
  price numeric, currency text, image_url text, source text, active boolean, created_at timestamptz, element_count integer
) language sql stable security invoker as $$
  with t as (select lower(trim(coalesce(p_q, ''))) as q),
  w as (
    select array_agg('%' || replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%' order by length(x) desc) as pats
    from t, regexp_split_to_table(t.q, '\s+') x where x <> ''
  )
  select a.id, a.article_number, a.supplier_id, a.supplier_sku, a.ean, a.name, a.category_code, a.series, a.price, a.currency,
    a.image_url, a.source, a.active, a.created_at,
    (select count(*)::int from catalog_article_elements e where e.parent_id = a.id) as element_count
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

-- Bijwerken in de database zelf, voor de nachtelijke sync van de showroom (n8n): roep dit aan na finish_supplier_showroom_sync.
-- Doet hetzelfde als syncCatalogArticles in de app voor de showroom: nieuwe artikelen en elementen krijgen een nummer,
-- bestaande houden het hunne, de elementen van de productpagina's worden vastgelegd (alleen toevoegen).
-- Delen uit de naam ("deel 1 van 3") en de webshop koppelt alleen de app.
create function sync_catalog_articles_showroom(p_supplier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_code text; v_new int; v_upd int; v_off int; v_links int; v_first bigint;
begin
  select id, code into v_sup, v_code from suppliers where lower(trim(name)) = lower(trim(p_supplier));
  if v_sup is null then raise exception 'Leverancier % staat niet onder Beheer.', p_supplier; end if;
  if v_code is null then raise exception 'Leverancier % heeft nog geen afkorting. Vul die in onder Beheer.', p_supplier; end if;

  with u as (
    update catalog_articles a set ean = i.ean, name = i.name, series = i.series, price = i.price, currency = i.currency,
      image_url = i.image_url, source = 'showroom', active = i.active
    from supplier_showroom_items i
    where i.supplier_name = p_supplier and a.supplier_id = v_sup and lower(a.supplier_sku) = lower(i.supplier_sku)
      and (a.ean, a.name, a.series, a.price, a.currency, a.image_url, a.source, a.active)
        is distinct from (i.ean, i.name, i.series, i.price, i.currency, i.image_url, 'showroom', i.active)
    returning 1
  ) select count(*) into v_upd from u;

  drop table if exists pg_temp.new_articles;
  create temp table new_articles on commit drop as
    select i.supplier_sku, i.ean, i.name, i.series, i.price, i.currency, i.image_url, i.active,
      coalesce(
        (select c.code from article_categories c, unnest(string_to_array(i.categories, '|')) with ordinality as cat(name, n)
          where c.pattern is not null and trim(cat.name) ~* c.pattern order by cat.n, c.priority limit 1),
        (select c.code from article_categories c where c.pattern is not null and i.name ~* c.pattern order by c.priority limit 1)
      ) as category_code
    from supplier_showroom_items i
    where i.supplier_name = p_supplier
      and not exists (select 1 from catalog_articles a where a.supplier_id = v_sup and lower(a.supplier_sku) = lower(i.supplier_sku));

  -- Een element zonder herkenbare categorie volgt het artikel waar het bij hoort.
  update new_articles n set category_code = coalesce((
    select coalesce(a.category_code, p.category_code)
    from supplier_showroom_details d
    left join catalog_articles a on a.supplier_id = v_sup and lower(a.supplier_sku) = lower(d.supplier_sku)
    left join new_articles p on lower(p.supplier_sku) = lower(d.supplier_sku)
    where d.supplier_name = p_supplier and d.elements ? n.supplier_sku and coalesce(a.category_code, p.category_code) is not null
    limit 1), 'OVR')
  where n.category_code is null;

  select count(*) into v_new from new_articles;
  if v_new > 0 then
    v_first := reserve_article_numbers(v_new);
    insert into catalog_articles (article_number, supplier_id, supplier_sku, ean, name, category_code, series, price, currency, image_url, source, active)
    select v_code || '-' || n.category_code || '-' || lpad((v_first + n.rn - 1)::text, 10, '0'), v_sup, n.supplier_sku, n.ean, n.name, n.category_code,
      n.series, n.price, n.currency, n.image_url, 'showroom', n.active
    from (select *, row_number() over (order by supplier_sku) as rn from new_articles) n;
  end if;

  -- Verdwenen uit de showroom: inactief, nooit verwijderd.
  with o as (
    update catalog_articles a set active = false
    where a.supplier_id = v_sup and a.source = 'showroom' and a.active
      and exists (select 1 from supplier_showroom_items where supplier_name = p_supplier) and not exists (
        select 1 from supplier_showroom_items i where i.supplier_name = p_supplier and lower(i.supplier_sku) = lower(a.supplier_sku))
    returning 1
  ) select count(*) into v_off from o;

  insert into catalog_article_elements (parent_id, element_id, position)
  select pa.id, ea.id, e.n
  from supplier_showroom_details d
  cross join jsonb_array_elements_text(d.elements) with ordinality as e(sku, n)
  join catalog_articles pa on pa.supplier_id = v_sup and lower(pa.supplier_sku) = lower(d.supplier_sku)
  join catalog_articles ea on ea.supplier_id = v_sup and lower(ea.supplier_sku) = lower(e.sku)
  where d.supplier_name = p_supplier and pa.id <> ea.id
  on conflict do nothing;
  get diagnostics v_links = row_count;

  return jsonb_build_object('new', v_new, 'changed', v_upd, 'deactivated', v_off, 'links', v_links);
end $$;
revoke all on function sync_catalog_articles_showroom(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function sync_catalog_articles_showroom(text) to service_role; end if;
end $$;
grant execute on function sync_catalog_articles_showroom(text) to authenticated;

alter table article_categories enable row level security;
alter table catalog_articles enable row level security;
alter table catalog_article_elements enable row level security;
create policy team_read on article_categories for select to authenticated using (true);
create policy team_all on catalog_articles for all to authenticated using (true) with check (true);
create policy team_all on catalog_article_elements for all to authenticated using (true) with check (true);
grant select on article_categories to authenticated;
grant select, insert, update on catalog_articles to authenticated;
grant select, insert on catalog_article_elements to authenticated;
grant usage on sequence catalog_article_seq to authenticated;
grant execute on function reserve_article_numbers(integer) to authenticated;
grant execute on function search_catalog_articles(text, uuid[], integer) to authenticated;
