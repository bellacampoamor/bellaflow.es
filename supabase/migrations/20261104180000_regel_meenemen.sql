-- Per orderregel: direct meegenomen bij verkoop, of later geleverd.
alter table sales_order_lines add column take_now boolean not null default false;
