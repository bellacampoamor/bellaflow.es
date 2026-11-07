// Hulpfuncties voor de catalogi: csv lezen, namen vergelijken en leveranciers-html veilig tonen. Geen opslag, geen UI.

/** Leest csv volgens RFC 4180: velden tussen aanhalingstekens mogen komma's, regeleinden en dubbele "" bevatten. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  const [head = [], ...body] = rows
  const keys = head.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const ALLOWED = new Set(['strong', 'b', 'em', 'i', 'u', 'br', 'p', 'ul', 'ol', 'li', 'h3', 'h4'])
/** Leveranciers-html met alleen opmaak: geen scripts, links, stijlen of attributen. */
export function safeHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (tag, name: string) => {
      const n = name.toLowerCase()
      if (!ALLOWED.has(n)) return ''
      if (n === 'br') return '<br>'
      return tag.startsWith('</') ? `</${n}>` : `<${n}>`
    })
    .replace(/<(?![a-z/])/gi, '&lt;')
}
export const plainText = (html: string) => safeHtml(html).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** Afbeeldingen alleen via http(s) of uit de eigen map; nooit javascript: of andere schema's. */
export function imageSrc(url: string, base = '/') {
  if (/^https?:\/\//i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return ''
  return `${base}${url.replace(/^\//, '')}`
}

