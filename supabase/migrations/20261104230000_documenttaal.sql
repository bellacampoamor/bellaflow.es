-- Taal per afgedrukt document; 'klant' volgt de taal van de klant.
alter table settings
  add column language_delivery_note text not null default 'klant' check (language_delivery_note in ('klant', 'es', 'en', 'nl')),
  add column language_invoice text not null default 'klant' check (language_invoice in ('klant', 'es', 'en', 'nl'));
