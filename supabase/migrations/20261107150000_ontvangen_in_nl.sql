-- Inkoop-flow (7 november 2026): een inkoopregel kan pas op een transport als hij in Nederland klaarstaat.
-- inbound_shipments is één rij per inkoopregel; nl_received_at is de datum waarop die regel in Nederland is ontvangen.

alter table inbound_shipments add column if not exists nl_received_at date;

-- Wat al op een transport staat of al ontvangen is, stond dus in Nederland klaar.
update inbound_shipments x set nl_received_at = p.order_date
  from purchase_orders p
  where p.id = x.purchase_order_id and x.nl_received_at is null
    and (x.transport_id is not null or x.status in ('received', 'partial'));

alter table inbound_shipments drop constraint if exists inbound_shipments_transport_na_nl;
alter table inbound_shipments add constraint inbound_shipments_transport_na_nl
  check (transport_id is null or nl_received_at is not null);
