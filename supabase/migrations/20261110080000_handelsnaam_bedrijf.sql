-- Handelsnaam van het eigen bedrijf, naast de juridische naam (company_name).
alter table public.settings add column if not exists trade_name text not null default '';
comment on column public.settings.trade_name is 'Handelsnaam van het eigen bedrijf; company_name is de juridische naam (razón social).';
