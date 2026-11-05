-- Taal van afgedrukte lijsten, zoals het factuuroverzicht. Een lijst hoort bij geen klant, dus er is altijd een vaste keuze.
alter table settings add column language_reports text not null default 'nl' check (language_reports in ('es', 'en', 'nl'));
