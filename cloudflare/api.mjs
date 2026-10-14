// API Cloudflare Pages Functions — D1 ou Supabase (REST PostgREST).
// Aucune API Node : Web Crypto + fetch uniquement, exécutable dans un Worker.
//
// Backend choisi automatiquement, dans cet ordre :
// - liaison D1 `DB` présente → SQLite D1 (développement local, tests) ;
// - sinon `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → Supabase (production) ;
// - sinon 503 DB_NOT_CONFIGURED (jamais de compteur inventé).
import {
  CONSENT_VERSION,
  ROLES,
  cleanText,
  csvCell,
  validEmail,
  validateSignature,
} from '../shared/petition.mjs'

const MAX_BODY_BYTES = 12 * 1024
const RATE_WINDOW_MS = 10 * 60 * 1000
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_ACTION = 'sign_petition'
const EXPORT_LIMIT = 250
const WITHDRAWAL_CODE_PATTERN = /^[\w-]{32}$/

const encoder = new TextEncoder()

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sha256Hex(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value)).then((digest) => hex(new Uint8Array(digest)))
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return hex(new Uint8Array(signature))
}

function randomWithdrawalCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function timingSafeEqualString(a, b) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length || left.length === 0) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index]
  return diff === 0
}

function requestOrigin(request) {
  try {
    return new URL(request.url).origin
  } catch {
    return ''
  }
}

function requestHostname(request) {
  try {
    return new URL(request.url).hostname
  } catch {
    return ''
  }
}

function hasForbiddenOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin !== requestOrigin(request)
  } catch {
    return true
  }
}

function clientIp(request) {
  const connecting = request.headers.get('cf-connecting-ip')
  if (connecting && connecting.trim()) return connecting.split(',')[0].trim() || 'unknown'
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded && forwarded.trim()) return forwarded.split(',')[0].trim() || 'unknown'
  return 'unknown'
}

async function parseJsonBody(request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return { error: json({ error: 'Le formulaire doit être envoyé en JSON.' }, 415) }
  }
  const text = await request.text()
  if (encoder.encode(text).length > MAX_BODY_BYTES) {
    return { error: json({ error: 'Le formulaire est trop volumineux.' }, 413) }
  }
  let body
  try {
    body = JSON.parse(text || '{}')
  } catch {
    return { error: json({ error: 'Le formulaire reçu est invalide.' }, 400) }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: json({ error: 'Le formulaire reçu est invalide.' }, 400) }
  }
  return { body }
}

function rateLimitConfig(env) {
  return {
    limit: positiveInteger(env.SIGNATURE_RATE_LIMIT, 60),
    // Secret stable entre les isolates : indispensable pour une limite distribuée.
    // À personnaliser en production (chaîne aléatoire), sinon repli déterministe.
    secret: (env.SIGNATURE_RATE_SECRET ?? '').trim() || 'leborgne-rate-limit-v1',
  }
}

async function rateLimitBucket(secret, ip, action, nowMs) {
  const window = Math.floor(nowMs / RATE_WINDOW_MS)
  const bucket = await hmacHex(secret, `${ip}\n${action}\n${window}`)
  return { bucket, expiresAt: (window + 1) * RATE_WINDOW_MS }
}

function rateLimitExceeded(expiresAt, nowMs) {
  const retryAfter = Math.max(1, Math.ceil((Number(expiresAt) - nowMs) / 1000))
  return json(
    { error: 'Trop de tentatives depuis cette connexion. Réessayez dans une dizaine de minutes.' },
    429,
    { 'Retry-After': String(retryAfter) },
  )
}

async function checkTurnstile(request, env, body, fetchFn) {
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim()
  const secretKey = (env.TURNSTILE_SECRET_KEY ?? '').trim()
  if (!siteKey && !secretKey) return null
  if (!siteKey || !secretKey) {
    return json(
      {
        code: 'TURNSTILE_NOT_CONFIGURED',
        error: 'La vérification anti-robot est incomplète côté serveur. Merci de réessayer plus tard.',
      },
      503,
    )
  }
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : ''
  if (!token) {
    return json(
      {
        error: 'Validez la vérification anti-robot avant de signer.',
        fields: { turnstile: 'Validez la vérification anti-robot avant de signer.' },
      },
      422,
    )
  }
  let verification = null
  try {
    const response = await fetchFn(TURNSTILE_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: secretKey, response: token }),
    })
    verification = await response.json()
  } catch {
    return json(
      { error: 'La vérification anti-robot est momentanément indisponible. Merci de réessayer.' },
      503,
    )
  }
  if (
    !verification?.success ||
    verification.action !== TURNSTILE_ACTION ||
    verification.hostname !== requestHostname(request)
  ) {
    return json(
      {
        error: 'La vérification anti-robot a échoué. Merci de réessayer.',
        fields: { turnstile: 'La vérification anti-robot a échoué. Merci de réessayer.' },
      },
      422,
    )
  }
  return null
}

function turnstileSiteKey(env) {
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim()
  return siteKey || null
}

function toRoleCounts(rows) {
  const counts = { eleve: 0, personnel: 0, parent: 0, ancien: 0, soutien: 0 }
  for (const row of rows) {
    const role = String(row.role ?? '')
    if (role in counts) counts[role] = Number(row.count ?? 0)
  }
  return counts
}

function sbCountedTotal(counted) {
  const range = counted.headers?.get?.('content-range') ?? ''
  const total = Number(range.split('/')[1])
  return Number.isSafeInteger(total) && total >= 0 ? total : null
}

function toSupporter(row) {
  const lastName = String(row.last_name ?? row.lastName ?? '')
  return {
    firstName: String(row.first_name ?? row.firstName ?? ''),
    lastInitial: lastName ? [...lastName][0] : '',
    role: String(row.role ?? ''),
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
  }
}

function d1ErrorKind(error) {
  const message = String(error?.message ?? error ?? '')
  if (/no such table/i.test(message)) return 'NOT_INITIALIZED'
  if (/quota/i.test(message)) return 'QUOTA'
  return 'OTHER'
}

function d1StorageError(kind) {
  if (kind === 'QUOTA') {
    return json(
      {
        code: 'FREE_QUOTA_REACHED',
        error: 'Le quota gratuit de la base est atteint. Réessayez après son renouvellement ; aucune signature n’a été perdue.',
      },
      503,
    )
  }
  return json(
    {
      code: 'D1_NOT_INITIALIZED',
      error: 'La base de signatures n’est pas initialisée. Exécutez migrations/0001_signatures.sql sur la base D1.',
    },
    503,
  )
}

function duplicateEmailResponse() {
  return json(
    {
      error: 'Une signature a déjà été enregistrée avec cette adresse e-mail. Merci pour votre soutien !',
      fields: { email: 'Cette adresse e-mail a déjà signé la pétition.' },
    },
    409,
  )
}

// ---------------------------------------------------------------------------
// Backend D1 (liaison `DB`)
// ---------------------------------------------------------------------------

async function d1CheckRateLimit(db, config, action, request, nowMs) {
  try {
    const { bucket, expiresAt } = await rateLimitBucket(config.secret, clientIp(request), action, nowMs)
    await db.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(nowMs).run()
    const row = await db
      .prepare('SELECT attempts, expires_at AS expiresAt FROM request_limits WHERE bucket = ?')
      .bind(bucket)
      .first()
    if (row && Number(row.attempts) >= config.limit) {
      return rateLimitExceeded(row.expiresAt, nowMs)
    }
    await db
      .prepare(
        `INSERT INTO request_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1, expires_at = excluded.expires_at`,
      )
      .bind(bucket, expiresAt)
      .run()
    return null
  } catch (error) {
    // La limite anti-abus ne doit jamais bloquer la pétition si sa table manque.
    console.warn('Rate limit indisponible :', error?.message ?? error)
    return null
  }
}

async function d1Sign(db, body, goal, nowMs) {
  const stats = await db.prepare('SELECT id FROM petition_stats WHERE id = 1').first()
  if (!stats) return d1StorageError('NOT_INITIALIZED')
  for (let attempt = 0; attempt < 2; attempt++) {
    const withdrawalCode = randomWithdrawalCode()
    const createdAt = new Date(nowMs).toISOString()
    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO signatures
             (first_name, last_name, email, role, message, is_public, consent_version, created_at, withdrawal_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            body.firstName,
            body.lastName,
            body.email,
            body.role,
            body.message,
            body.isPublic === true ? 1 : 0,
            CONSENT_VERSION,
            createdAt,
            await sha256Hex(withdrawalCode),
          ),
        db.prepare('SELECT total_count AS count FROM petition_stats WHERE id = 1'),
      ])
      const count = Number(results[1]?.results?.[0]?.count ?? 0)
      return json({ count, goal, firstName: body.firstName, withdrawalCode }, 201)
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      const message = String(error?.message ?? '')
      if (/UNIQUE constraint failed: signatures\.email/i.test(message)) return duplicateEmailResponse()
      if (/UNIQUE constraint failed: signatures\.withdrawal_hash/i.test(message) && attempt === 0) continue
      throw error
    }
  }
  return json({ error: 'La signature n’a pas pu être enregistrée. Merci de réessayer.' }, 503)
}

async function handleD1(request, path, env, db, { nowMs, fetchFn }) {
  const goal = positiveInteger(env.SIGNATURE_GOAL, 1000)
  const rateConfig = rateLimitConfig(env)

  if (path === '/api/health') {
    try {
      const stats = await db.prepare('SELECT total_count AS count FROM petition_stats WHERE id = 1').first()
      if (!stats) return d1StorageError('NOT_INITIALIZED')
      return json({ status: 'ok', storage: 'd1', count: Number(stats.count ?? 0) })
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      throw error
    }
  }

  if (path === '/api/petition') {
    try {
      const stats = await db
        .prepare('SELECT total_count AS total, public_count AS publicTotal FROM petition_stats WHERE id = 1')
        .first()
      if (!stats) return d1StorageError('NOT_INITIALIZED')
      const supporters = await db
        .prepare(
          `SELECT first_name, last_name, role, created_at FROM signatures
           WHERE is_public = 1 ORDER BY id DESC LIMIT 50`,
        )
        .all()
      const counts = await db
        .prepare(`SELECT role, COUNT(*) AS count FROM signatures WHERE is_public = 1 AND role != '' GROUP BY role`)
        .all()
      return json({
        count: Number(stats.total ?? 0),
        goal,
        publicCount: Number(stats.publicTotal ?? 0),
        supporters: (supporters.results ?? []).map(toSupporter),
        roleCounts: toRoleCounts(counts.results ?? []),
        turnstileSiteKey: turnstileSiteKey(env),
      })
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      throw error
    }
  }

  if (path === '/api/supporters') {
    const role = cleanText(new URL(request.url).searchParams.get('role') ?? '')
    if (!ROLES.includes(role)) return json({ error: 'Profil invalide.' }, 422)
    try {
      const where = role ? 'WHERE is_public = 1 AND role = ?' : 'WHERE is_public = 1'
      const params = role ? [role] : []
      const supporters = await db
        .prepare(`SELECT first_name, last_name, role, created_at FROM signatures ${where} ORDER BY id DESC LIMIT 50`)
        .bind(...params)
        .all()
      const total = await db
        .prepare(`SELECT COUNT(*) AS count FROM signatures ${where}`)
        .bind(...params)
        .first()
      return json({
        supporters: (supporters.results ?? []).map(toSupporter),
        total: Number(total?.count ?? 0),
      })
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      throw error
    }
  }

  if (path === '/api/admin/signatures.csv') {
    return d1Export(request, env, db)
  }

  const parsed = await parseJsonBody(request)
  if (parsed.error) return parsed.error
  const body = parsed.body

  if (path === '/api/signatures') {
    if (body.website) return json({ error: 'Envoi non valide.' }, 400)
    const { firstName, lastName, email, role, message, fields } = validateSignature(body)
    if (Object.keys(fields).length) {
      return json({ error: 'Vérifiez les informations du formulaire.', fields }, 422)
    }
    const turnstile = await checkTurnstile(request, env, body, fetchFn)
    if (turnstile) return turnstile
    const limited = await d1CheckRateLimit(db, rateConfig, 'sign', request, nowMs)
    if (limited) return limited
    try {
      return await d1Sign(db, { firstName, lastName, email, role, message, isPublic: body.isPublic }, goal, nowMs)
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      throw error
    }
  }

  if (path === '/api/signatures/withdraw') {
    const code = cleanText(body.withdrawalCode)
    if (!WITHDRAWAL_CODE_PATTERN.test(code)) {
      return json({ error: 'Indiquez la référence de 32 caractères reçue après votre signature.' }, 422)
    }
    const limited = await d1CheckRateLimit(db, rateConfig, 'withdraw', request, nowMs)
    if (limited) return limited
    try {
      const deleted = await db
        .prepare('DELETE FROM signatures WHERE withdrawal_hash = ?')
        .bind(await sha256Hex(code))
        .run()
      if (!deleted.meta.changes) {
        return json({ error: 'Cette référence est introuvable ou la signature a déjà été retirée.' }, 404)
      }
      const stats = await db.prepare('SELECT total_count AS count FROM petition_stats WHERE id = 1').first()
      return json({ count: Number(stats?.count ?? 0), goal, withdrawn: true })
    } catch (error) {
      const kind = d1ErrorKind(error)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
      throw error
    }
  }

  return json({ error: 'Cette route n’existe pas.' }, 404)
}

async function d1Export(request, env, db) {
  const authorized = checkExportAuth(request, env)
  if (!authorized.ok) return authorized.response
  const cursor = exportCursor(request)
  if (cursor.error) return cursor.error
  try {
    const result = await db
      .prepare(
        `SELECT id, first_name, last_name, email, role, message, is_public, consent_version, created_at
         FROM signatures WHERE id > ? ORDER BY id ASC LIMIT ${EXPORT_LIMIT + 1}`,
      )
      .bind(cursor.after)
      .all()
    return exportCsvResponse(result.results ?? [])
  } catch (error) {
    const kind = d1ErrorKind(error)
    if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return d1StorageError(kind)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Backend Supabase (REST PostgREST, sans SDK — compatible Workers)
// ---------------------------------------------------------------------------

function urlFromDatabaseUrl(databaseUrl) {
  const value = (databaseUrl ?? '').trim()
  const match = value.match(/db\.([a-z0-9-]+)\.(supabase\.co|supabase\.com)\b/i)
  if (!match) return ''
  return `https://${match[1].toLowerCase()}.${match[2].toLowerCase()}`
}

function supabaseConfig(env) {
  const url = ((env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '') || urlFromDatabaseUrl(env.DATABASE_URL)).trim()
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY ?? '').trim()
  if (!url || !key) return null
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
  } catch {
    return null
  }
  return { url: url.replace(/\/+$/, ''), key }
}

async function sbRequest(sb, fetchFn, table, { method = 'GET', query = {}, body, prefer, single = false } = {}) {
  const url = new URL(`${sb.url}/rest/v1/${table}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  const headers = {
    apikey: sb.key,
    Authorization: `Bearer ${sb.key}`,
    Accept: single ? 'application/vnd.pgrst.object+json' : 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const init = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetchFn(url.toString(), init)
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { status: response.status, ok: response.ok, data, raw: text, headers: response.headers }
}

function sbErrorKind(result) {
  const message = String(result?.data?.message ?? result?.data?.error ?? result?.raw ?? '')
  const code = String(result?.data?.code ?? '')
  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  ) {
    return 'NOT_INITIALIZED'
  }
  if (/quota/i.test(message)) return 'QUOTA'
  if (/exceeded/i.test(message) && /(rows|bandwidth|limit|storage|request|database|statement)/i.test(message)) {
    return 'QUOTA'
  }
  if (code === '23505' || result?.status === 409) return 'CONFLICT'
  if (result?.status === 406 && code === 'PGRST116') return 'NO_ROWS'
  return 'OTHER'
}

function sbStorageError(kind) {
  if (kind === 'QUOTA') {
    return json(
      {
        code: 'FREE_QUOTA_REACHED',
        error: 'Le quota gratuit de la base est atteint. Réessayez après son renouvellement ; aucune signature n’a été perdue.',
      },
      503,
    )
  }
  return json(
    {
      code: 'SUPABASE_NOT_INITIALIZED',
      error: 'Les tables Supabase sont introuvables. Exécutez migrations/0001_signatures-postgres.sql dans l’éditeur SQL de Supabase.',
    },
    503,
  )
}

function sbFailure(result) {
  const kind = sbErrorKind(result)
  if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return sbStorageError(kind)
  return json({ error: 'La base de signatures est momentanément indisponible. Merci de réessayer.' }, 503)
}

async function sbCheckRateLimit(sb, fetchFn, config, action, request, nowMs) {
  try {
    const { bucket, expiresAt } = await rateLimitBucket(config.secret, clientIp(request), action, nowMs)
    await sbRequest(sb, fetchFn, 'request_limits', {
      method: 'DELETE',
      query: { expires_at: `lte.${nowMs}` },
    })
    const existing = await sbRequest(sb, fetchFn, 'request_limits', {
      query: { select: 'attempts,expires_at', bucket: `eq.${bucket}` },
      single: true,
    })
    if (existing.ok && existing.data) {
      if (Number(existing.data.attempts) >= config.limit) {
        return rateLimitExceeded(existing.data.expires_at, nowMs)
      }
      await sbRequest(sb, fetchFn, 'request_limits', {
        method: 'PATCH',
        query: { bucket: `eq.${bucket}` },
        body: { attempts: Number(existing.data.attempts) + 1, expires_at: expiresAt },
      })
      return null
    }
    await sbRequest(sb, fetchFn, 'request_limits', {
      method: 'POST',
      body: { bucket, attempts: 1, expires_at: expiresAt },
      prefer: 'return=minimal,resolution=merge-duplicates',
    })
    return null
  } catch (error) {
    console.warn('Rate limit indisponible :', error?.message ?? error)
    return null
  }
}

async function sbReadStats(sb, fetchFn) {
  const stats = await sbRequest(sb, fetchFn, 'petition_stats', {
    query: { select: 'total_count,public_count', id: 'eq.1' },
    single: true,
  })
  if (stats.ok && stats.data) return { ok: true, stats: stats.data }
  return { ok: false, result: stats }
}

async function sbCountFallback(sb, fetchFn) {
  // Compte direct des lignes si la table des compteurs est illisible.
  const counted = await sbRequest(sb, fetchFn, 'signatures', {
    query: { select: 'id', limit: 1 },
    prefer: 'count=exact',
  })
  return sbCountedTotal(counted)
}

async function sbSign(sb, fetchFn, input, goal, nowMs) {
  const precheck = await sbReadStats(sb, fetchFn)
  if (!precheck.ok) {
    const kind = sbErrorKind(precheck.result)
    if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED' || kind === 'NO_ROWS') return sbStorageError(kind === 'QUOTA' ? 'QUOTA' : 'NOT_INITIALIZED')
    return sbFailure(precheck.result)
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const withdrawalCode = randomWithdrawalCode()
    const inserted = await sbRequest(sb, fetchFn, 'signatures', {
      method: 'POST',
      body: {
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        role: input.role,
        message: input.message,
        is_public: input.isPublic === true ? 1 : 0,
        consent_version: CONSENT_VERSION,
        created_at: new Date(nowMs).toISOString(),
        withdrawal_hash: await sha256Hex(withdrawalCode),
      },
      prefer: 'return=minimal',
    })
    if (inserted.ok) {
      const stats = await sbReadStats(sb, fetchFn)
      if (stats.ok) {
        return json({ count: Number(stats.stats.total_count ?? 0), goal, firstName: input.firstName, withdrawalCode }, 201)
      }
      // La signature EST enregistrée : ne jamais répondre 503, sinon l’utilisateur
      // croit à un échec et se heurte ensuite à un doublon.
      const fallback = await sbCountFallback(sb, fetchFn)
      return json(
        { count: fallback ?? Number(precheck.stats.total_count ?? 0) + 1, goal, firstName: input.firstName, withdrawalCode },
        201,
      )
    }
    const kind = sbErrorKind(inserted)
    if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED') return sbStorageError(kind)
    if (kind === 'CONFLICT') {
      const message = String(inserted.data?.message ?? '')
      if (/email/i.test(message)) return duplicateEmailResponse()
      if (attempt === 0) continue
      return duplicateEmailResponse()
    }
    return sbFailure(inserted)
  }
  return json({ error: 'La signature n’a pas pu être enregistrée. Merci de réessayer.' }, 503)
}

async function sbRoleCounts(sb, fetchFn) {
  const roles = ['eleve', 'personnel', 'parent', 'ancien', 'soutien']
  const results = await Promise.all(
    roles.map((role) =>
      sbRequest(sb, fetchFn, 'signatures', {
        query: { select: 'id', is_public: 'eq.1', role: `eq.${role}`, limit: 1 },
        prefer: 'count=exact',
      }),
    ),
  )
  const counts = { eleve: 0, personnel: 0, parent: 0, ancien: 0, soutien: 0 }
  for (let index = 0; index < roles.length; index++) {
    const result = results[index]
    if (!result.ok) return { ok: false, result }
    counts[roles[index]] = sbCountedTotal(result) ?? 0
  }
  return { ok: true, counts }
}

async function handleSupabase(request, path, env, sb, { nowMs, fetchFn }) {
  const goal = positiveInteger(env.SIGNATURE_GOAL, 1000)
  const rateConfig = rateLimitConfig(env)

  if (path === '/api/health') {
    const stats = await sbReadStats(sb, fetchFn)
    if (!stats.ok) {
      const kind = sbErrorKind(stats.result)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED' || kind === 'NO_ROWS') {
        return sbStorageError(kind === 'QUOTA' ? 'QUOTA' : 'NOT_INITIALIZED')
      }
      return sbFailure(stats.result)
    }
    return json({ status: 'ok', storage: 'supabase', count: Number(stats.stats.total_count ?? 0) })
  }

  if (path === '/api/petition') {
    const [stats, supporters, counts] = await Promise.all([
      sbReadStats(sb, fetchFn),
      sbRequest(sb, fetchFn, 'signatures', {
        query: { select: 'first_name,last_name,role,created_at', is_public: 'eq.1', order: 'id.desc', limit: 50 },
      }),
      sbRoleCounts(sb, fetchFn),
    ])
    if (!stats.ok) {
      const kind = sbErrorKind(stats.result)
      if (kind === 'QUOTA' || kind === 'NOT_INITIALIZED' || kind === 'NO_ROWS') {
        return sbStorageError(kind === 'QUOTA' ? 'QUOTA' : 'NOT_INITIALIZED')
      }
      return sbFailure(stats.result)
    }
    if (!supporters.ok) return sbFailure(supporters)
    if (!counts.ok) return sbFailure(counts.result)
    return json({
      count: Number(stats.stats.total_count ?? 0),
      goal,
      publicCount: Number(stats.stats.public_count ?? 0),
      supporters: (Array.isArray(supporters.data) ? supporters.data : []).map(toSupporter),
      roleCounts: counts.counts,
      turnstileSiteKey: turnstileSiteKey(env),
    })
  }

  if (path === '/api/supporters') {
    const role = cleanText(new URL(request.url).searchParams.get('role') ?? '')
    if (!ROLES.includes(role)) return json({ error: 'Profil invalide.' }, 422)
    const [supporters, counted] = await Promise.all([
      sbRequest(sb, fetchFn, 'signatures', {
        query: {
          select: 'first_name,last_name,role,created_at',
          is_public: 'eq.1',
          ...(role ? { role: `eq.${role}` } : {}),
          order: 'id.desc',
          limit: 50,
        },
      }),
      sbRequest(sb, fetchFn, 'signatures', {
        query: { select: 'id', is_public: 'eq.1', ...(role ? { role: `eq.${role}` } : {}), limit: 1 },
        prefer: 'count=exact',
      }),
    ])
    if (!supporters.ok) return sbFailure(supporters)
    if (!counted.ok) return sbFailure(counted)
    return json({
      supporters: (Array.isArray(supporters.data) ? supporters.data : []).map(toSupporter),
      total: sbCountedTotal(counted) ?? 0,
    })
  }

  if (path === '/api/admin/signatures.csv') {
    const authorized = checkExportAuth(request, env)
    if (!authorized.ok) return authorized.response
    const cursor = exportCursor(request)
    if (cursor.error) return cursor.error
    const rows = await sbRequest(sb, fetchFn, 'signatures', {
      query: {
        select: 'id,first_name,last_name,email,role,message,is_public,consent_version,created_at',
        id: `gt.${cursor.after}`,
        order: 'id.asc',
        limit: EXPORT_LIMIT + 1,
      },
    })
    if (!rows.ok) return sbFailure(rows)
    return exportCsvResponse(Array.isArray(rows.data) ? rows.data : [])
  }

  const parsed = await parseJsonBody(request)
  if (parsed.error) return parsed.error
  const body = parsed.body

  if (path === '/api/signatures') {
    if (body.website) return json({ error: 'Envoi non valide.' }, 400)
    const { firstName, lastName, email, role, message, fields } = validateSignature(body)
    if (Object.keys(fields).length) {
      return json({ error: 'Vérifiez les informations du formulaire.', fields }, 422)
    }
    const turnstile = await checkTurnstile(request, env, body, fetchFn)
    if (turnstile) return turnstile
    const limited = await sbCheckRateLimit(sb, fetchFn, rateConfig, 'sign', request, nowMs)
    if (limited) return limited
    return sbSign(sb, fetchFn, { firstName, lastName, email, role, message, isPublic: body.isPublic }, goal, nowMs)
  }

  if (path === '/api/signatures/withdraw') {
    const code = cleanText(body.withdrawalCode)
    if (!WITHDRAWAL_CODE_PATTERN.test(code)) {
      return json({ error: 'Indiquez la référence de 32 caractères reçue après votre signature.' }, 422)
    }
    const limited = await sbCheckRateLimit(sb, fetchFn, rateConfig, 'withdraw', request, nowMs)
    if (limited) return limited
    const deleted = await sbRequest(sb, fetchFn, 'signatures', {
      method: 'DELETE',
      query: { withdrawal_hash: `eq.${await sha256Hex(code)}` },
      prefer: 'return=representation',
    })
    if (!deleted.ok) return sbFailure(deleted)
    const rows = Array.isArray(deleted.data) ? deleted.data : []
    if (!rows.length) {
      return json({ error: 'Cette référence est introuvable ou la signature a déjà été retirée.' }, 404)
    }
    const stats = await sbReadStats(sb, fetchFn)
    if (!stats.ok) {
      const fallback = await sbCountFallback(sb, fetchFn)
      return json({ count: fallback ?? 0, goal, withdrawn: true })
    }
    return json({ count: Number(stats.stats.total_count ?? 0), goal, withdrawn: true })
  }

  return json({ error: 'Cette route n’existe pas.' }, 404)
}

// ---------------------------------------------------------------------------
// Export CSV privé (commun aux deux backends)
// ---------------------------------------------------------------------------

function checkExportAuth(request, env) {
  const adminToken = env.ADMIN_TOKEN ?? ''
  if (adminToken.length < 32) {
    return { ok: false, response: json({ error: 'L’export privé n’est pas configuré.' }, 503) }
  }
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
  if (!supplied || !timingSafeEqualString(supplied, adminToken)) {
    return { ok: false, response: json({ error: 'Accès non autorisé.' }, 401) }
  }
  return { ok: true }
}

function exportCursor(request) {
  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after') ?? 0)
  if (!Number.isSafeInteger(after) || after < 0) {
    return { error: json({ error: 'Le curseur d’export est invalide.' }, 422) }
  }
  return { after }
}

function exportCsvResponse(rows) {
  const batch = rows.slice(0, EXPORT_LIMIT)
  const hasMore = rows.length > EXPORT_LIMIT
  const headers = ['Prénom', 'Nom', 'E-mail', 'Profil', 'Message privé', 'Affichage public autorisé', 'Version du consentement', 'Date UTC']
  const lines = [
    headers,
    ...batch.map((row) => [
      row.first_name,
      row.last_name,
      row.email,
      row.role,
      row.message ?? '',
      row.is_public ? 'Oui' : 'Non',
      row.consent_version,
      row.created_at,
    ]),
  ]
  const csv = '\uFEFF' + lines.map((line) => line.map(csvCell).join(';')).join('\r\n')
  const responseHeaders = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="signatures-leborgne-en-action.csv"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Export-Count': String(batch.length),
    'X-Export-Complete': hasMore ? 'false' : 'true',
  }
  if (hasMore && batch.length > 0) {
    const cursor = String(batch[batch.length - 1].id)
    responseHeaders['X-Next-Cursor'] = cursor
  }
  return new Response(csv, { headers: responseHeaders })
}

// ---------------------------------------------------------------------------
// Point d’entrée
// ---------------------------------------------------------------------------

const KNOWN_ROUTES = {
  '/api/health': 'GET',
  '/api/petition': 'GET',
  '/api/supporters': 'GET',
  '/api/signatures': 'POST',
  '/api/signatures/withdraw': 'POST',
  '/api/admin/signatures.csv': 'GET',
}

export async function handleApi(request, env, _context = {}, dependencies = {}) {
  const nowMs = typeof dependencies.now === 'function' ? dependencies.now() : Date.now()
  const fetchFn = dependencies.fetch ?? globalThis.fetch
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/'
    if (!KNOWN_ROUTES[path]) return json({ error: 'Cette route n’existe pas.' }, 404)
    if (request.method !== KNOWN_ROUTES[path]) {
      return json({ error: 'Méthode non autorisée.' }, 405, { Allow: KNOWN_ROUTES[path] })
    }
    if (request.method === 'POST') {
      if (hasForbiddenOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json({ error: 'Merci de faire cette demande depuis le site de la pétition.' }, 403)
      }
    }

    if (env.DB) {
      return await handleD1(request, path, env, env.DB, { nowMs, fetchFn })
    }
    const sb = supabaseConfig(env)
    if (sb) {
      return await handleSupabase(request, path, env, sb, { nowMs, fetchFn })
    }
    if (path === '/api/admin/signatures.csv') {
      // L’export exige son secret avant toute chose (même message sans base).
      const authorized = checkExportAuth(request, env)
      if (!authorized.ok) return authorized.response
    }
    return json(
      {
        code: 'DB_NOT_CONFIGURED',
        error: 'La base de signatures n’est pas configurée. Ajoutez la liaison D1 « DB » ou les variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans Cloudflare Pages, puis redéployez.',
      },
      503,
    )
  } catch (error) {
    // Jamais de pile technique ni de données personnelles vers le navigateur.
    console.error('API error:', error?.message ?? error)
    return json({ error: 'La base de signatures est momentanément indisponible. Merci de réessayer.' }, 503)
  }
}
