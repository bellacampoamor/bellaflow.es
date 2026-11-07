-- Besluit Rick 7 november 2026: Bella werkt alleen met de showroom van de leverancier. De webshoptabel vervalt.
-- sync_catalog_articles leest daarom alleen nog de showroom.

create or replace function sync_catalog_articles(p_supplier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_code text; v_res jsonb;
begin
  select id, code into v_sup, v_code from suppliers where lower(trim(name)) = lower(trim(p_supplier));
  if v_sup is null then raise exception 'Leverancier % staat niet in suppliers.', p_supplier; end if;
  if v_code is null then
    raise exception 'Leverancier % heeft nog geen afkorting. Vul die in onder Beheer (of: update suppliers set code = ''LOL'' where name = ''%'').', p_supplier, p_supplier;
  end if;
  v_res := sync_catalog_articles_showroom(p_supplier);
  return v_res || jsonb_build_object('total', (select count(*) from catalog_articles where supplier_id = v_sup and active));
end $$;

-- De webshoptabel en de functies van de webshop-sync.
drop table if exists supplier_catalog_items cascade;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sync_supplier_catalog_chunk', 'finish_supplier_catalog_sync') loop
    execute 'drop function ' || f.sig;
  end loop;
end $$;

-- Eventuele artikelen die alleen uit de webshop kwamen, blijven bestaan (nummers wijzigen nooit) maar worden inactief.
update catalog_articles set active = false where source = 'webshop' and active;
