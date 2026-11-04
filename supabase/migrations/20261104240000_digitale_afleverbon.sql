-- Papieren of digitale afleverbon, met de handtekening van de klant bij de levering.
alter table settings add column delivery_note_mode text not null default 'papier' check (delivery_note_mode in ('papier', 'digitaal'));
alter table deliveries
  add column signature_data text,
  add column signed_at timestamptz;
