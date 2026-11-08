-- Verkopers heten voortaan Medewerkers en krijgen een rol: verkoper, administratie of beheerder.
-- De tabel blijft salespeople (verkooporders verwijzen ernaar). Bestaande medewerkers worden verkoper.
-- Toegang per rol (koppeling met inloggen en RLS) volgt later.
alter table salespeople add column if not exists role text not null default 'verkoper';
alter table salespeople drop constraint if exists salespeople_role_check;
alter table salespeople add constraint salespeople_role_check check (role in ('verkoper', 'administratie', 'beheerder'));
comment on column salespeople.role is 'Rol van de medewerker: verkoper, administratie of beheerder.';
