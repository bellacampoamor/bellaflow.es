-- Elke inkoopregel krijgt een eigen rij in inbound_shipments en wordt zo per regel aan een transport gekoppeld.
-- Een ontvangst hoort bij een transport en kan regels van meerdere inkooporders bevatten.
alter table goods_receipts alter column shipment_id drop not null;
alter table goods_receipts add column transport_id uuid references transports (id);
