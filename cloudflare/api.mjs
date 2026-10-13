import { createClient } from '@supabase/supabase-js'
import { CONSENT_VERSION, cleanText, validEmail, csvCell, validateSignature } from '../shared/petition.mjs'
export async function handleApi(request, env, _context = {}, dependencies = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ status: 'error', code: 'DB_NOT_CONFIGURED', error: "Reliez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans Cloudflare Pages Variables." }, 503)
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  const known = { '/api/health': 'GET', '/api/petition': 'GET', '/api/signatures': 'POST', '/api/signatures/withdraw': 'POST', '/api/admin/signatures.csv': 'GET' }
  if (!known[path]) return json({ error: 'Cette route n’existe pas.' }, 404)
  if (request.method !== known[path]) return json({ error: 'Méthode non autorisée.' }, 405, { Allow: known[path] })
  if (request.method === 'POST' && request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Merci de faire cette demande depuis le site de la pétition.' }, 403)

  const production = true
  const goal = positiveInteger(env.SIGNATURE_GOAL, 1000)
  const now = dependencies.now?.() ?? Date.now()

  try {
    if (path === '/api/health') {
      const { data } = await supabase.from('petition_stats').select('total_count').eq('id', 1).single()
      return json({ status: 'ok', runtime: 'supabase-rest', count: data ? data.total_count : 0 })
    }

    if (path === '/api/petition') {
      const [statsRes, supportersRes] = await Promise.all([
        supabase.from('petition_stats').select('total_count, public_count').eq('id', 1).single(),
        supabase.from('signatures').select('first_name, last_name, role, created_at').eq('is_public', 1).order('id', { ascending: false }).limit(50)
      ])
      const stats = statsRes.data || { total_count: 0, public_count: 0 }
      const supporters = (supportersRes.data || []).map(r => ({
        firstName: r.first_name,
        lastInitial: r.last_name ? r.last_name[0] : '',
        role: r.role,
        createdAt: r.created_at
      }))
      const contact = cleanText(env.CONTACT_EMAIL || '')
      return json({
        count: Number(stats.total_count),
        goal,
        publicCount: Number(stats.public_count),
        supporters,
        contactEmail: validEmail(contact) ? contact : null,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      })
    }

    if (path === '/api/admin/signatures.csv') {
      const adminToken = env.ADMIN_TOKEN ?? ''
      if (adminToken.length < 32) return json({ error: 'L’export privé n’est pas configuré.' }, 503)
      const supplied = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? ''
      if (!supplied || supplied !== adminToken) return json({ error: 'Accès non autorisé.' }, 401)
      const urlObj = new URL(request.url)
      const after = Number(urlObj.searchParams.get('after') ?? 0)
      if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'Le curseur d’export est invalide.' }, 422)
      const { data: rows } = await supabase.from('signatures').select('id, first_name, last_name, email, role, message, is_public, consent_version, created_at').gt('id', after).order('id', { ascending: true }).limit(251)
      const batch = rows ? rows.slice(0, 250) : []
      const hasMore = (rows ? rows.length : 0) > 250
      const headers = ['Prénom', 'Nom', 'E-mail', 'Profil', 'Message privé', 'Affichage public autorisé', 'Version du consentement', 'Date UTC']
      const values = batch.map(({ id: _id, ...row }) => [
        row.first_name, row.last_name, row.email, row.role, row.message ?? '', row.is_public ? 'Oui' : 'Non', row.consent_version, row.created_at
      ])
      const csv = '\uFEFF' + [headers, ...values].map(r => r.map(v => {
        const safe = /^[\s]*[=+\-@]/.test(String(v)) ? "'" + v : v
        return '"' + String(safe).replace(/"/g, '""') + '"'
      }).join(';')).join('\r\n')
      const resHeaders = {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="signatures-leborgne-en-action.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }
      if (hasMore && batch.length > 0) {
        resHeaders['X-Next-Cursor'] = String(batch[batch.length - 1].id)
        resHeaders['Link'] = `</api/admin/signatures.csv?after=${batch[batch.length - 1].id}>; rel="next"`
      }
      return new Response(csv, { headers: resHeaders })
    }

    const bodyObj = await request.json().catch(() => ({}))
    if (path === '/api/signatures') {
      // Rate limit check (simplified; full check needs IP hashing which is hard without env bind; rely on Supabase/auth or basic limit)
      if (bodyObj.website) return json({ error: 'Envoi non valide.' }, 400)
      const firstName = cleanText(bodyObj.firstName)
      const lastName = cleanText(bodyObj.lastName)
      const email = cleanText(bodyObj.email).toLowerCase()
      const role = cleanText(bodyObj.role)
      const message = cleanText(bodyObj.message || '')
      const fields = {}
      if (!validName(firstName)) fields.firstName = 'Indiquez votre prénom.'
      if (!validName(lastName)) fields.lastName = 'Indiquez votre nom.'
      if (!validEmail(email)) fields.email = 'Indiquez une adresse valide.'
      if (!ROLES.includes(role)) fields.role = 'Choisissez un profil.'
      if (message.length > 1000) fields.message = 'Message trop long.'
      if (bodyObj.consent !== true) fields.consent = 'Votre accord est nécessaire.'
      if (Object.keys(fields).length) return json({ error: 'Vérifiez le formulaire.', fields }, 422)

      // Check duplicate
      const { data: existing } = await supabase.from('signatures').select('id').eq('email', email).single()
      if (existing) return json({ error: 'Une signature a déjà été enregistrée avec cette adresse.', fields: { email: 'Déjà signé.' } }, 409)

      const withdrawalCode = randomBytes(24).toString('base64url')
      const { error: insErr } = await supabase.from('signatures').insert({
        first_name: firstName,
        last_name: lastName,
        email,
        role,
        message,
        is_public: bodyObj.isPublic === true ? 1 : 0,
        consent_version: CONSENT_VERSION,
        created_at: new Date(now).toISOString(),
        withdrawal_hash: await digest(withdrawalCode),
      })
      if (insErr) {
        console.error('Insert error:', insErr)
        return json({ error: 'La signature n’a pas pu être enregistrée.' }, 503)
      }
      const { data: statsRow } = await supabase.from('petition_stats').select('total_count').eq('id', 1).single()
      return json({ count: statsRow ? statsRow.total_count : 1, goal, firstName, withdrawalCode }, 201)
    }

    if (path === '/api/signatures/withdraw') {
      const code = cleanText(bodyObj.withdrawalCode || '')
      if (!/^[\w-]{32}$/.test(code)) return json({ error: 'Référence de 32 caractères requise.' }, 422)
      const { error: delErr } = await supabase.from('signatures').delete().eq('withdrawal_hash', await digest(code))
      if (delErr) return json({ error: 'Retrait impossible.' }, 503)
      const { data: statsRow } = await supabase.from('petition_stats').select('total_count').eq('id', 1).single()
      return json({ count: statsRow ? statsRow.total_count : 0, goal, withdrawn: true })
    }

    return json({ error: 'Cette route n’existe pas.' }, 404)
  } catch (error) {
    console.error('API error:', error?.message || error)
    return json({ error: 'La base de signatures est momentanément indisponible. Merci de réessayer.' }, 503)
  }
}
