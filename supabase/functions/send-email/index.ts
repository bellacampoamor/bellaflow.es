// Verstuurt één mail uit email_outbox via Brevo. De ontvangers komen uit de database, niet uit het verzoek,
// zodat deze functie niet als open mailserver te gebruiken is.
// Instellen: supabase secrets set BREVO_API_KEY=...  Het winkeladres moet in Brevo een geverifieerde afzender zijn.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  // Alleen een ingelogde gebruiker mag een mail starten; daarna werkt de functie met de servicesleutel.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: user } = await asUser.auth.getUser()
  if (!user?.user) return reply(401, { error: 'Niet ingelogd.' })

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { id } = await req.json()
  const { data: mail } = await db.from('email_outbox').select('*').eq('id', id).single()
  if (!mail) return reply(404, { error: 'Mail niet gevonden.' })
  if (mail.status === 'sent') return reply(200, { status: 'sent' })
  if (!mail.to_email) return reply(400, { error: 'Geen e-mailadres van de klant.' })
  const { data: file } = await db.from('email_attachments').select('*').eq('email_id', id).single()
  const { data: settings } = await db.from('settings').select('company_name, shop_email').limit(1).single()
  if (!settings?.shop_email) return reply(400, { error: 'Stel onder Beheer het winkel e-mailadres in.' })

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': Deno.env.get('BREVO_API_KEY')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: settings.shop_email, name: settings.company_name },
      replyTo: { email: settings.shop_email },
      to: [{ email: mail.to_email }],
      ...(mail.bcc_email ? { bcc: [{ email: mail.bcc_email }] } : {}),
      subject: mail.subject,
      textContent: mail.body_text,
      ...(file ? { attachment: [{ name: file.file_name, content: file.content_base64 }] } : {}),
    }),
  })
  if (!res.ok) {
    const error = `Brevo ${res.status}: ${await res.text()}`
    await db.from('email_outbox').update({ status: 'failed', error }).eq('id', id)
    return reply(502, { error })
  }
  await db.from('email_outbox').update({ status: 'sent', error: '', sent_at: new Date().toISOString() }).eq('id', id)
  return reply(200, { status: 'sent' })
})
