// Domeintypes. Veldnamen zijn gelijk aan de kolommen in supabase/migrations.

export interface Settings {
  id: string; company_name: string; tax_id: string; address: string; postal_code: string; city: string
  province: string; phone: string; email: string; iban: string
  payment_days: number; invoice_footer: string
  prefix_sales_order: string; prefix_purchase: string; prefix_receipt: string; prefix_delivery: string; prefix_invoice: string; prefix_transport: string; prefix_proforma: string
  delivery_note_mode: 'papier' | 'digitaal'; shop_email: string; language_delivery_note: DocumentLanguage; language_invoice: DocumentLanguage
}
export interface Warehouse {
  id: string; code: string; name: string; kind: 'winkel' | 'magazijn' | 'extern'
  address: string; postal_code: string; city: string; phone: string; contact_name: string
  receives_goods: boolean; ships_goods: boolean; is_active: boolean
  latitude: number | null; longitude: number | null; is_route_origin: boolean
}
export interface Supplier {
  id: string; name: string; vat_number: string; contact_name: string; email: string; phone: string
  address: string; postal_code: string; city: string; country: string; lead_time_days: number; payment_terms: string
  notes: string; is_active: boolean
}
export type Language = 'es' | 'nl' | 'en'
export type DocumentLanguage = Language | 'klant'
export interface Customer {
  id: string; kind: 'particulier' | 'zakelijk'; name: string; company: string; tax_id: string
  email: string; phone: string; language: Language; address: string; postal_code: string
  city: string; province: string; country: string; notes: string
}
export interface Salesperson { id: string; name: string; email: string; phone: string; is_active: boolean }
export interface Product {
  id: string; sku: string; name: string; collection: string; category: string; material: string
  color: string; dimensions: string; weight_kg: number; colli: number; purchase_price: number
  sale_price: number; vat_rate: number; supplier_id: string | null; min_stock: number; is_active: boolean; volume_m3: number
}
export type OrderType = 'direct' | 'bestelling'
export type Fulfilment = 'meenemen' | 'verzenden' | 'bezorgen'
export interface SalesOrder {
  id: string; number: string; customer_id: string; order_date: string
  channel: 'winkel' | 'online' | 'telefoon' | 'beurs'; salesperson_id: string; customer_reference: string
  order_type: OrderType; fulfilment: Fulfilment; requested_date: string | null; promised_date: string | null
  delivery_name: string; delivery_phone: string; delivery_address: string; delivery_postal_code: string
  delivery_city: string; delivery_latitude: number | null; delivery_longitude: number | null; floor: string; has_elevator: boolean; needs_assembly: boolean
  remove_old_furniture: boolean; delivery_notes: string; notes: string; status: 'open' | 'cancelled'
}
export interface SalesOrderLine {
  id: string; sales_order_id: string; product_id: string; description: string; options: string
  qty: number; unit_price: number; discount_pct: number; vat_rate: number
  source: 'voorraad' | 'bestelling'; warehouse_id: string | null; take_now: boolean
}
export interface OrderEvent {
  id: string; sales_order_id: string; kind: string; message: string; old_date: string | null
  new_date: string | null; customer_notified: boolean; created_at: string
}
export type PurchaseLabel = 'showroom' | 'magazijn' | 'verkoop'
export interface PurchaseOrder {
  id: string; number: string; supplier_id: string; order_date: string; supplier_reference: string
  notes: string; status: 'open' | 'cancelled'; label: PurchaseLabel
}
export interface PurchaseOrderLine {
  id: string; purchase_order_id: string; product_id: string; qty: number; unit_cost: number
  sales_order_line_id: string | null
}
export interface Transport {
  id: string; number: string; departure_date: string; arrival_date: string; carrier: string; reference: string
  capacity_m3: number; status: 'planned' | 'departed' | 'arrived' | 'cancelled'; notes: string
}
export interface InboundShipment {
  id: string; purchase_order_id: string; sequence: number; expected_date: string; original_date: string
  warehouse_id: string; carrier: string; status: 'expected' | 'partial' | 'received' | 'closed'; notes: string; transport_id: string | null
}
export interface InboundShipmentLine { id: string; shipment_id: string; purchase_order_line_id: string; qty: number }
export interface GoodsReceipt {
  id: string; number: string; shipment_id: string | null; transport_id: string | null; received_date: string; delivery_note: string
  received_by: string; notes: string
}
export interface GoodsReceiptLine {
  id: string; receipt_id: string; shipment_line_id: string; product_id: string; warehouse_id: string
  qty_received: number; qty_damaged: number; location_bin: string
}
export interface StockMovement {
  id: string; product_id: string; warehouse_id: string; qty: number
  kind: 'ontvangst' | 'levering' | 'overboeking' | 'correctie'; ref_id: string; note: string; moved_at: string
}
export interface Delivery {
  id: string; number: string; sales_order_id: string; sequence: number
  method: 'meenemen' | 'vervoerder' | 'eigen_team'; planned_date: string; carrier: string
  status: 'planned' | 'ready' | 'in_transit' | 'delivered' | 'cancelled'; delivered_at: string | null
  signed_by: string; notes: string; ready_at: string | null; approved_by: string; note_printed_at: string | null
  signed_note_received: boolean; route_position: number | null; proforma_number: string | null
  signature_data: string | null; signed_at: string | null
}
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'no_recipient' | 'demo'
export interface OutgoingEmail {
  id: string; kind: 'getekende_afleverbon'; delivery_id: string; to_email: string; bcc_email: string
  subject: string; body_text: string; status: EmailStatus; error: string; created_at: string; sent_at: string | null
}
export interface EmailAttachment { name: string; base64: string }
export interface DeliveryLine {
  id: string; delivery_id: string; sales_order_line_id: string; warehouse_id: string; qty: number
}
export interface Invoice {
  id: string; number: string; sales_order_id: string; customer_id: string
  kind: 'deelfactuur' | 'eindfactuur' | 'volledig'; invoice_date: string; due_date: string
  base_amount: number; vat_amount: number; total: number; deposit_settled: number; language: Language
}
export interface InvoiceLine {
  id: string; invoice_id: string; delivery_line_id: string | null; article_number: string; description: string; qty: number
  unit_price: number; discount_pct: number; vat_rate: number; line_total: number
}
export interface Payment {
  id: string; sales_order_id: string; invoice_id: string | null; kind: 'vooruitbetaling' | 'betaling'
  method: 'pin' | 'contant' | 'overboeking' | 'online'; amount: number; paid_at: string; reference: string
}
export interface NumberSeries { id: string; last_number: number }

export interface Snapshot {
  settings: Settings[]; warehouses: Warehouse[]; suppliers: Supplier[]; customers: Customer[]; salespeople: Salesperson[]; products: Product[]
  sales_orders: SalesOrder[]; sales_order_lines: SalesOrderLine[]; order_events: OrderEvent[]
  purchase_orders: PurchaseOrder[]; purchase_order_lines: PurchaseOrderLine[]
  transports: Transport[]; inbound_shipments: InboundShipment[]; inbound_shipment_lines: InboundShipmentLine[]
  goods_receipts: GoodsReceipt[]; goods_receipt_lines: GoodsReceiptLine[]; stock_movements: StockMovement[]
  deliveries: Delivery[]; delivery_lines: DeliveryLine[]; invoices: Invoice[]; invoice_lines: InvoiceLine[]
  payments: Payment[]; number_series: NumberSeries[]; email_outbox: OutgoingEmail[]
}
export type TableName = keyof Snapshot

// Volgorde respecteert de foreign keys; gebruikt voor laden en voor seed.sql.
export const TABLES: TableName[] = [
  'settings', 'warehouses', 'suppliers', 'customers', 'salespeople', 'products', 'sales_orders', 'sales_order_lines',
  'order_events', 'purchase_orders', 'purchase_order_lines', 'transports', 'inbound_shipments', 'inbound_shipment_lines',
  'goods_receipts', 'goods_receipt_lines', 'stock_movements', 'deliveries', 'delivery_lines', 'invoices',
  'invoice_lines', 'payments', 'number_series', 'email_outbox',
]
