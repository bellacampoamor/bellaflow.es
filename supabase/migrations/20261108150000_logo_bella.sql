-- Standaardlogo en -beeldmerk van Bella (aangeleverd door Rick, 8 november 2026) op de eenvoudige factuur van de kassa.
-- Een upload onder Instellingen > Bedrijf en factuur gaat voor.
alter table settings alter column logo_bella set default 'assets/brand/bella-logo.png';
alter table settings alter column mark_bella set default 'assets/brand/bella-beeldmerk.png';
update settings set logo_bella = 'assets/brand/bella-logo.png' where logo_bella = '';
update settings set mark_bella = 'assets/brand/bella-beeldmerk.png' where mark_bella = '';
