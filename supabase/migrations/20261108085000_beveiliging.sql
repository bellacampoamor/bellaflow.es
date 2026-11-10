-- Beveiliging (8 november 2026): alleen teamleden zien en wijzigen gegevens.
-- Elke policy met using (true) / with check (true) wordt using ((select public.is_team_member())).
-- anon krijgt geen tabelrechten meer; SECURITY DEFINER-functies alleen nog voor service_role,
-- behalve de vier token-functies van de browserscripts. Zie claude/bella-flow-beveiliging.md.
-- Nieuwe migraties: nooit using (true), altijd is_team_member() of is_admin().
create table if not exists public.team_members (
  user_id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;

do $$
begin
  if to_regclass('auth.users') is not null and not exists (
    select 1 from pg_constraint where conname = 'team_members_user_id_fkey') then
    alter table public.team_members
      add constraint team_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create or replace function public.is_team_member() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return exists (select 1 from public.team_members m where m.user_id = auth.uid());
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') and to_regprocedure('auth.uid()') is not null then
    execute 'drop policy if exists own_row on public.team_members';
    execute 'create policy own_row on public.team_members for select to authenticated using (user_id = (select auth.uid()))';
  end if;
end $$;

do $$
declare p record; v_cmd text;
begin
  for p in
    select tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and (qual = 'true' or with_check = 'true')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    if p.cmd in ('SELECT', 'DELETE') then
      v_cmd := format('create policy %I on public.%I for %s to authenticated using ((select public.is_team_member()))',
        p.policyname, p.tablename, p.cmd);
    elsif p.cmd = 'INSERT' then
      v_cmd := format('create policy %I on public.%I for insert to authenticated with check ((select public.is_team_member()))',
        p.policyname, p.tablename);
    else
      v_cmd := format('create policy %I on public.%I for %s to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()))',
        p.policyname, p.tablename, p.cmd);
    end if;
    execute v_cmd;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.team_members from authenticated';
    execute 'grant select on public.team_members to authenticated';
  end if;
end $$;

do $$
declare f record;
  v_has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  v_has_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
  v_has_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.prosecdef
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if v_has_anon then execute format('revoke execute on function %s from anon', f.sig); end if;
    if v_has_auth then
      if f.prosecdef and f.proname <> 'is_team_member' then
        execute format('revoke execute on function %s from authenticated', f.sig);
      else
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
    end if;
    if v_has_service then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;

  if v_has_anon then
    for f in
      select p.oid::regprocedure as sig from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('showroom_ingest', 'showroom_script', 'suns_ingest', 'suns_ingest_script')
    loop
      execute format('grant execute on function %s to anon', f.sig);
    end loop;
  end if;

  execute 'alter default privileges in schema public revoke execute on functions from public';
  if v_has_anon then
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proconfig is null
      and p.proname in ('catalog_article_number_fixed', 'search_catalog_articles', 'reserve_article_numbers',
                        'haco_item_usable', 'haco_parent_sku_only')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
