import { CONSENT_VERSION, cleanText, validEmail, csvCell, validateSignature } from '../shared/petition.mjs'

const MAX_BODY_BYTES = 12 * 1024
const RATE_WINDOW_SECONDS = 10 * 60
const EXPORT_BATCH_SIZE = 250
const encoder = new TextEncoder()
const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'"

export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } })
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function equalSecret(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)])
  let different = 0
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return different === 0
}

function newWithdrawalCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function positiveInteger(value, fallback, max = 1_000_000) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : fallback
}

async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return { error: json({ error: 'Le formulaire doit être envoyé au format JSON.' }, 415) }
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return { error: json({ error: 'Le formulaire est trop volumineux.' }, 413) }
  }
  const reader = request.body?.getReader()
  if (!reader) return { error: json({ error: 'Le formulaire reçu est invalide.' }, 400) }
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) {
        await reader.cancel()
        return { error: json({ error: 'Le formulaire est trop volumineux.' }, 413) }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_object')
    return { body }
  } catch {
    return { error: json({ error: 'Le formulaire reçu est invalide.' }, 400) }
  }
}

function crossOrigin(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true
  const origin = request.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).origin !== new URL(request.url).origin } catch { return true }
}

async function getStats(db) {
  const stats = await db.prepare('SELECT total_count AS count, public_count AS publicCount FROM petition_stats WHERE id = 1').first()
  if (!stats) throw new Error('D1_SCHEMA_NOT_INITIALIZED')
  return { count: Number(stats.count), publicCount: Number(stats.publicCount) }
}

async function limitWrites(request, env, scope, now) {
  const seconds = Math.floor(now / 1000)
  const windowStart = Math.floor(seconds / RATE_WINDOW_SECONDS) * RATE_WINDOW_SECONDS
  const expires = windowStart + RATE_WINDOW_SECONDS
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local-development'
  // HMAC et clé privée si configurée. Aucun enregistrement de l'IP en clair.
  const secret = env.SIGNATURE_RATE_SECRET || env.ADMIN_TOKEN
  const material = `${new URL(request.url).hostname}|${scope}|${ip}|${windowStart}`
  let bucket
  if (secret) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(material))
    bucket = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } else {
    bucket = await digest(material)
  }
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(seconds),
    env.DB.prepare(`INSERT INTO request_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT (bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`).bind(bucket, expires),
  ])
  const attempts = Number(result[1]?.results?.[0]?.attempts)
  if (!Number.isSafeInteger(attempts)) throw new Error('D1_RATE_LIMIT_FAILED')
  const limit = scope === 'admin' ? 30 : positiveInteger(env.SIGNATURE_RATE_LIMIT, 60, 10_000)
  if (attempts > limit) {
    return json({ error: 'Trop de tentatives depuis cette connexion. Réessayez dans une dizaine de minutes.' }, 429, { 'Retry-After': String(Math.max(1, expires - seconds)) })
  }
  return null
}

async function verifyTurnstile(request, body, env, fetcher) {
  if (!env.TURNSTILE_SECRET_KEY) return null
  const token = cleanText(body.turnstileToken)
  if (!token || token.length > 2048) return json({ error: 'Validez la vérification anti-robot avant de signer.', fields: { turnstile: 'La vérification anti-robot est nécessaire.' } }, 422)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const payload = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token })
    const ip = request.headers.get('CF-Connecting-IP')
    if (ip) payload.set('remoteip', ip)
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: payload, signal: controller.signal,
    })
    if (!response.ok) throw new Error('turnstile_service_unavailable')
    const result = await response.json()
    if (result.success !== true || result.action !== 'sign_petition' || result.hostname !== new URL(request.url).hostname) {
      return json({ error: 'La vérification anti-robot a expiré ou est invalide. Merci de la renouveler.', fields: { turnstile: 'Renouvelez la vérification anti-robot.' } }, 422)
    }
    return null
  } catch {
    return json({ error: 'La vérification anti-robot est momentanément indisponible. Votre signature n’a pas été confirmée.' }, 503)
  } finally { clearTimeout(timer) }
}

async function exportCsv(request, env, now) {
  const adminToken = env.ADMIN_TOKEN ?? ''
  if (adminToken.length < 32) return json({ error: 'L’export privé n’est pas configuré.' }, 503)
  const limited = await limitWrites(request, env, 'admin', now)
  if (limited) return limited
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? ''
  if (!await equalSecret(supplied, adminToken)) return json({ error: 'Accès non autorisé.' }, 401)
  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after') ?? 0)
  if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'Le curseur d’export est invalide.' }, 422)
  const data = await env.DB.prepare(`SELECT id, first_name, last_name, email, role, message,
    is_public, consent_version, created_at FROM signatures WHERE id > ? ORDER BY id ASC LIMIT ?`)
    .bind(after, EXPORT_BATCH_SIZE + 1).all()
  const rows = data.results.slice(0, EXPORT_BATCH_SIZE)
  const hasMore = data.results.length > EXPORT_BATCH_SIZE
  const headers = ['Prénom', 'Nom', 'E-mail', 'Profil', 'Message privé', 'Affichage public autorisé', 'Version du consentement', 'Date UTC']
  const values = rows.map(({ id: _id, ...row }) => Object.values(row))
  const csv = '\uFEFF' + [headers, ...values].map((row) => row.map(csvCell).join(';')).join('\r\n')
  const responseHeaders = {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="signatures-leborgne-en-action.csv"',
    'X-Export-Complete': String(!hasMore),
    'X-Export-Count': String(rows.length),
  }
  if (hasMore) {
    const next = String(rows.at(-1).id)
    responseHeaders['X-Next-Cursor'] = next
    responseHeaders.Link = `</api/admin/signatures.csv?after=${next}>; rel="next"`
  }
  return new Response(csv, { headers: responseHeaders })
}

/** API Pages Functions. L'interface reste sur des URL relatives, sans CORS public. */
export async function handleApi(request, env, _context = {}, dependencies = {}) {
  // Supabase / PostgreSQL fallback
  if (env.DATABASE_URL && !env.DB?.prepare) {
    try {
      const { createDBFromEnv } = await import('../shared/postgres-adapter.mjs')
      env.DB = createDBFromEnv(env)
    } catch {
      // ignore
    }
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  const known = {
    '/api/health': 'GET', '/api/petition': 'GET', '/api/signatures': 'POST',
    '/api/signatures/withdraw': 'POST', '/api/admin/signatures.csv': 'GET',
  }
  if (!known[path]) return json({ error: 'Cette route n’existe pas.' }, 404)
  if (request.method !== known[path]) return json({ error: 'Méthode non autorisée.' }, 405, { Allow: known[path] })
  if (request.method === 'POST' && crossOrigin(request)) return json({ error: 'Merci de faire cette demande depuis le site de la pétition.' }, 403)
  if (!env.DB?.prepare && !env.DATABASE_URL) {
    return json({ status: 'error', code: 'DB_NOT_CONFIGURED', error: "La base n'est pas configurée. Reliez une base D1 (variable DB) OU configurez DATABASE_URL (Supabase) dans Cloudflare Pages Variables." }, 503)
  }
  // Supabase / PostgreSQL adapter: utilisée quand DATABASE_URL est présent sans DB (D1)
  if (env.DATABASE_URL && !env.DB?.prepare) {
    try {
      const { createDBFromEnv } = await import('../shared/postgres-adapter.mjs')
      env.DB = createDBFromEnv(env)
    } catch (e) {
      console.error('Adapter Supabase échoué (postgres):', e?.message || e)
    }
  }
  // Note : DATABASE_URL est reconnu mais le backend actuel requiert D1 (env.DB).
  // Pour Supabase pur, remplacez env.DB par un appel supabase-js dans cette fonction.
  if (Boolean(env.TURNSTILE_SITE_KEY) !== Boolean(env.TURNSTILE_SECRET_KEY)) {
    return json({ code: 'TURNSTILE_NOT_CONFIGURED', error: 'La protection anti-robot doit avoir ses deux clés configurées, ou être désactivée.' }, 503)
  }
  const goal = positiveInteger(env.SIGNATURE_GOAL, 1000)
  const now = dependencies.now?.() ?? Date.now()
  try {
    if (path === '/api/health') {
      await getStats(env.DB)
      return json({ status: 'ok', runtime: 'cloudflare-pages', storage: 'd1' })
    }
    if (path === '/api/petition') {
      const [stats, supporters] = await env.DB.batch([
        env.DB.prepare('SELECT total_count AS count, public_count AS publicCount FROM petition_stats WHERE id = 1'),
        env.DB.prepare(`SELECT first_name AS firstName, substr(last_name, 1, 1) AS lastInitial, role, created_at AS createdAt
          FROM signatures WHERE is_public = 1 ORDER BY id DESC LIMIT 50`),
      ])
      if (!stats.results[0]) throw new Error('D1_SCHEMA_NOT_INITIALIZED')
      const contact = cleanText(env.CONTACT_EMAIL)
      return json({
        count: Number(stats.results[0].count), goal, publicCount: Number(stats.results[0].publicCount),
        supporters: supporters.results, contactEmail: validEmail(contact) ? contact : null,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      })
    }
    if (path === '/api/admin/signatures.csv') return await exportCsv(request, env, now)
    const parsed = await readBody(request)
    if (parsed.error) return parsed.error
    const body = parsed.body
    if (path === '/api/signatures') {
      if (body.website) return json({ error: 'Envoi non valide.' }, 400)
      const { firstName, lastName, email, role, message, fields } = validateSignature(body)
      if (Object.keys(fields).length) return json({ error: 'Vérifiez les informations du formulaire.', fields }, 422)
      const limited = await limitWrites(request, env, 'signatures', now)
      if (limited) return limited
      const verification = await verifyTurnstile(request, body, env, dependencies.fetch ?? fetch)
      if (verification) return verification
      const withdrawalCode = newWithdrawalCode()
      let recordedStats
      try {
        // Signature et compteur dans la même transaction : une erreur de quota
        // pendant la lecture ne doit pas enregistrer une signature sans référence.
        const results = await env.DB.batch([
          env.DB.prepare(`INSERT INTO signatures
            (first_name, last_name, email, role, message, is_public, consent_version, created_at, withdrawal_hash)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM petition_stats WHERE id = 1)`)
            .bind(firstName, lastName, email, role, message, body.isPublic === true ? 1 : 0,
              CONSENT_VERSION, new Date(now).toISOString(), await digest(withdrawalCode)),
          env.DB.prepare('SELECT total_count AS count FROM petition_stats WHERE id = 1'),
        ])
        recordedStats = results[1].results[0]
        if (!results[0].meta.changes || !recordedStats) throw new Error('D1_SCHEMA_NOT_INITIALIZED')
      } catch (error) {
        if (String(error.message).includes('UNIQUE constraint failed: signatures.email')) {
          return json({ error: 'Une signature a déjà été enregistrée avec cette adresse e-mail. Merci pour votre soutien !', fields: { email: 'Cette adresse e-mail a déjà signé la pétition.' } }, 409)
        }
        throw error
      }
      return json({ count: Number(recordedStats.count), goal, firstName, withdrawalCode }, 201)
    }
    if (path === '/api/signatures/withdraw') {
      const code = cleanText(body.withdrawalCode)
      if (!/^[\w-]{32}$/.test(code)) return json({ error: 'Indiquez la référence de 32 caractères reçue après votre signature.' }, 422)
      const limited = await limitWrites(request, env, 'signatures', now)
      if (limited) return limited
      const [result, counts] = await env.DB.batch([
        env.DB.prepare('DELETE FROM signatures WHERE withdrawal_hash = ? AND EXISTS (SELECT 1 FROM petition_stats WHERE id = 1)').bind(await digest(code)),
        env.DB.prepare('SELECT total_count AS count FROM petition_stats WHERE id = 1'),
      ])
      if (!counts.results[0]) throw new Error('D1_SCHEMA_NOT_INITIALIZED')
      if (!result.meta.changes) return json({ error: 'Cette référence est introuvable ou la signature a déjà été retirée.' }, 404)
      return json({ count: Number(counts.results[0].count), goal, withdrawn: true })
    }
  } catch (error) {
    const message = String(error.message)
    if (/no such table|D1_SCHEMA_NOT_INITIALIZED/.test(message)) {
      return json({ status: 'error', code: 'D1_NOT_INITIALIZED', error: 'La base D1 doit être initialisée avec la migration SQL du projet avant de recevoir des signatures.' }, 503)
    }
    if (/quota|daily limit|storage limit|exceeded.*limit|exceeded.*read|exceeded.*write/i.test(message)) {
      return json({ code: 'FREE_QUOTA_REACHED', error: 'Le quota gratuit de la base est atteint. Réessayez après son renouvellement ; votre signature n’a pas été confirmée.' }, 503)
    }
    // Ne pas journaliser les requêtes SQL, l'adresse IP, le formulaire ou les secrets.
    console.error('API Cloudflare : échec du stockage D1.')
    return json({ error: 'La base de signatures est momentanément indisponible. Votre demande n’a pas été confirmée. Merci de réessayer.' }, 503)
  }
  return json({ error: 'Cette route n’existe pas.' }, 404)
}
