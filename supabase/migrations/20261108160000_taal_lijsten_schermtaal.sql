-- Lijsten (Rapportage) volgen standaard de schermtaal, tenzij onder Instellingen een vaste taal gekozen is (besluit Rick 8 november 2026).
-- Vervangt language_reports (vaste taal, standaard nl).
alter table settings add column if not exists language_lists text not null default 'scherm'
  check (language_lists in ('scherm', 'es', 'en', 'nl'));
alter table settings drop column if exists language_reports;
