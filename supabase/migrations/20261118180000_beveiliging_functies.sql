-- Beveiligingscontrole 18 november 2026.
-- refresh_names_es() was door elke ingelogde gebruiker aan te roepen (ook zonder medewerker te zijn),
-- en de twee triggerfuncties waren via /rpc bereikbaar voor anon en authenticated.
-- De app roept geen van drieën zelf aan; ze draaien alleen via triggers (SECURITY DEFINER),
-- en Postgres controleert EXECUTE op een triggerfunctie alleen bij CREATE TRIGGER.

revoke execute on function public.refresh_names_es() from public;
revoke execute on function public.trg_refresh_names_es() from public;
revoke execute on function public.trg_product_name_es() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.refresh_names_es() from anon, authenticated';
    execute 'revoke execute on function public.trg_refresh_names_es() from anon, authenticated';
    execute 'revoke execute on function public.trg_product_name_es() from anon, authenticated';
    execute 'grant execute on function public.refresh_names_es() to service_role';
  end if;
end $$;
