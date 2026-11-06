import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Driver } from './driver'
import type { EmailAttachment, Snapshot, TableName } from './types'

const PAGE = 1000

export function createSupabase(url: string, key: string) {
  return createClient(url, key)
}

export class SupabaseDriver implements Driver {
  constructor(private sb: SupabaseClient) {}

  async list<T extends TableName>(table: T) {
    const out: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select('*').range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      // numeric-kolommen komen als string of getal binnen; de app rekent met getallen
      out.push(...(data ?? []).map(toNumbers))
      if (!data || data.length < PAGE) break
    }
    return out as Snapshot[T]
  }
  async insert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    if (!rows.length) return
    const { error } = await this.sb.from(table).insert(rows as never)
    if (error) throw new Error(error.message)
  }
  async upsert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb.from(table).upsert(rows.slice(i, i + 500) as never)
      if (error) throw new Error(error.message)
    }
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>) {
    const { error } = await this.sb.from(table).update(patch as never).eq('id', id)
    if (error) throw new Error(error.message)
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)
  }
  async sendEmail(id: string, attachment: EmailAttachment) {
    const { error: fileError } = await this.sb.from('email_attachments').upsert({ email_id: id, file_name: attachment.name, content_base64: attachment.base64 })
    if (fileError) throw new Error(fileError.message)
    const { error } = await this.sb.functions.invoke('send-email', { body: { id } })
    if (error) throw new Error(error.message)
    return 'sent' as const
  }
  async nextNumber(series: string, year: number) {
    const { data, error } = await this.sb.rpc('next_number', { p_series: series, p_year: year })
    if (error) throw new Error(error.message)
    return data as string
  }
}

const NUMERIC = new Set([
  'weight_kg', 'purchase_price', 'sale_price', 'vat_rate', 'unit_price', 'discount_pct', 'unit_cost',
  'volume_m3', 'capacity_m3', 'latitude', 'longitude', 'delivery_latitude', 'delivery_longitude', 'base_amount', 'vat_amount', 'total', 'deposit_settled', 'line_total', 'amount', 'price_regular', 'price_final',
])
function toNumbers(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row }
  for (const k of Object.keys(out)) if (NUMERIC.has(k) && out[k] !== null) out[k] = Number(out[k])
  return out
}
