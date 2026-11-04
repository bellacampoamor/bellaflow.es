-- Instelbare voorvoegsels voor documentnummers. De doorlopende teller blijft per soort en jaar bestaan.
alter table settings
  add column prefix_sales_order text not null default 'VO',
  add column prefix_purchase text not null default 'IO',
  add column prefix_receipt text not null default 'OV',
  add column prefix_delivery text not null default 'LV',
  add column prefix_invoice text not null default 'F',
  add column prefix_transport text not null default 'TR';
