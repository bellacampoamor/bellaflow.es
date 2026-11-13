-- Jaarafsluiting (opdracht Rick 13 november 2026).
-- Het jaar in elk documentnummer (alle reeksen: VO, IO, LV, PF, OV, TR, F, FS-BELLA, FS-HDB, FR, FRS-...) komt uit het
-- open boekjaar, niet meer uit de datum. Pas de handmatige jaarafsluiting onder Instellingen zet het boekjaar verder;
-- dan begint elke reeks weer bij 0001. De tellers per jaar (number_series, id 'VO-2026') blijven altijd bestaan.
-- Bij elke afsluiting liggen de laatst gebruikte nummers vast, zodat terugdraaien kan zolang het nieuwe jaar nog
-- geen nummer heeft uitgegeven. Herhaalbaar.

alter table settings add column if not exists fiscal_year integer;
update settings set fiscal_year = 2026 where fiscal_year is null;

create table if not exists year_closings (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  closed_at timestamptz not null default now(),
  closed_by text not null,
  -- Per reeks: { series, label, last_number, last_document }
  last_numbers jsonb not null default '[]'::jsonb,
  rolled_back_at timestamptz,
  rolled_back_by text not null default ''
);
-- Een jaar kan maar één keer tegelijk afgesloten zijn (na terugdraaien opnieuw).
create unique index if not exists year_closings_open on year_closings (year) where rolled_back_at is null;

alter table year_closings enable row level security;
drop policy if exists year_closings_select on year_closings;
drop policy if exists year_closings_insert on year_closings;
drop policy if exists year_closings_update on year_closings;
create policy year_closings_select on year_closings for select to authenticated using ((select public.is_team_member()));
create policy year_closings_insert on year_closings for insert to authenticated with check ((select public.is_team_member()));
create policy year_closings_update on year_closings for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
-- Geen delete: de geschiedenis van afsluitingen blijft staan.
revoke delete on year_closings from authenticated, anon;
grant select, insert, update on year_closings to authenticated;
