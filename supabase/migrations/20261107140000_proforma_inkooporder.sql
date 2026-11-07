-- Proforma-inkooporder: een verkooporder met artikelen die niet op voorraad zijn, maakt vanzelf per leverancier
-- een inkooporder met de status proforma en een tijdelijk nummer (PIO-). Bij omzetten ontstaat de definitieve
-- inkooporder (IO-nummer, status open) en vervalt de proforma. Een proforma heeft geen regels op een transport.

alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check check (status in ('proforma', 'open', 'cancelled'));

-- Een proforma kan niet aan een transport of ontvangst hangen.
create or replace function purchase_proforma_zonder_zending() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from purchase_orders p where p.id = new.purchase_order_id and p.status = 'proforma') then
    raise exception 'Een proforma-inkooporder heeft nog geen zending. Zet hem eerst om naar een inkooporder.';
  end if;
  return new;
end $$;

drop trigger if exists inbound_shipments_geen_proforma on inbound_shipments;
create trigger inbound_shipments_geen_proforma before insert or update of purchase_order_id on inbound_shipments
  for each row execute function purchase_proforma_zonder_zending();
