-- Toeslag per leverancier op de prijs van de leverancier, voor transport en distributie van Nederland naar Spanje.
-- Wordt in de verkooporder onzichtbaar meegenomen: de verkoper ziet alleen de verhoogde prijs.
alter table suppliers add column price_surcharge_pct numeric(6, 2) not null default 0
  check (price_surcharge_pct >= 0 and price_surcharge_pct <= 500);
