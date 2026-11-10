-- Medewerkers met rol en login (8 november 2026), vult 20261108090000_medewerkers_rol.sql aan.
-- user_id koppelt een medewerker aan zijn login, automatisch op e-mailadres (beide richtingen).
-- Een actieve, gekoppelde medewerker is teamlid; team_members telt als beheerder (noodtoegang).
-- Alleen een beheerder mag medewerkers toevoegen, wijzigen of verwijderen.
-- De app vraagt de eigen rol op met rpc('current_employee_role') (null = geen toegang).
alter table public.salespeople add column if not exists role text not null default 'verkoper';
alter table public.salespeople add column if not exists user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salespeople_role_check') then
    alter table public.salespeople
      add constraint salespeople_role_check check (role in ('verkoper', 'administratie', 'beheerder'));
  end if;
  if to_regclass('auth.users') is not null and not exists (select 1 from pg_constraint where conname = 'salespeople_user_id_fkey') then
    alter table public.salespeople
      add constraint salespeople_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create unique index if not exists salespeople_user_id_key on public.salespeople (user_id) where user_id is not null;
create unique index if not exists salespeople_email_key on public.salespeople (lower(email)) where email <> '';

create or replace function public.current_employee_role() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_role text;
begin
  if auth.uid() is null then return null; end if;
  select s.role into v_role from public.salespeople s where s.user_id = auth.uid() and s.is_active;
  if v_role is not null then return v_role; end if;
  if exists (select 1 from public.team_members m where m.user_id = auth.uid()) then return 'beheerder'; end if;
  return null;
end $$;

create or replace function public.is_team_member() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return public.current_employee_role() is not null;
end $$;

create or replace function public.is_admin() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return public.current_employee_role() = 'beheerder';
end $$;

create or replace function public.link_salesperson_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is null and new.email <> '' and to_regclass('auth.users') is not null then
    execute 'select id from auth.users where lower(email) = lower($1) limit 1' into new.user_id using new.email;
  end if;
  return new;
end $$;

drop trigger if exists salespeople_link_user on public.salespeople;
create trigger salespeople_link_user before insert or update of email, user_id on public.salespeople
  for each row execute function public.link_salesperson_user();

do $$
begin
  if to_regclass('auth.users') is not null then
    execute $f$
      create or replace function public.link_auth_user_to_salesperson() returns trigger
      language plpgsql security definer set search_path = ''
      as $b$
      begin
        update public.salespeople set user_id = new.id
        where user_id is null and email <> '' and lower(email) = lower(new.email);
        return new;
      end $b$
    $f$;
    execute 'drop trigger if exists on_auth_user_link_salesperson on auth.users';
    execute 'create trigger on_auth_user_link_salesperson after insert or update of email on auth.users
      for each row execute function public.link_auth_user_to_salesperson()';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists team_all on public.salespeople';
    execute 'drop policy if exists team_read on public.salespeople';
    execute 'drop policy if exists admin_insert on public.salespeople';
    execute 'drop policy if exists admin_update on public.salespeople';
    execute 'drop policy if exists admin_delete on public.salespeople';
    execute 'create policy team_read on public.salespeople for select to authenticated using ((select public.is_team_member()))';
    execute 'create policy admin_insert on public.salespeople for insert to authenticated with check ((select public.is_admin()))';
    execute 'create policy admin_update on public.salespeople for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))';
    execute 'create policy admin_delete on public.salespeople for delete to authenticated using ((select public.is_admin()))';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.current_employee_role()', 'public.is_team_member()', 'public.is_admin()',
                           'public.link_salesperson_user()', 'public.link_auth_user_to_salesperson()'] loop
    if to_regprocedure(f) is null then continue; end if;
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') and f in ('public.current_employee_role()', 'public.is_team_member()', 'public.is_admin()') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
