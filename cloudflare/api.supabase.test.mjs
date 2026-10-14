import test from 'node:test'
import assert from 'node:assert/strict'
import { handleApi } from './api.mjs'

// Faux serveur PostgREST en mémoire : simule Supabase (REST) sans réseau,
// avec les mêmes déclencheurs de compteurs que la migration Postgres.
const SUPABASE_URL = 'https://test-projet.supabase.co'
const SERVICE_KEY = 'cle-service-de-test'
const base = 'https://petition.example.test'

const valid = (overrides = {}) => ({
  firstName: 'Camille',
  lastName: 'Laurent',
  email: 'camille@example.test',
  role: 'eleve',
  message: '',
  consent: true,
  isPublic: false,
  website: '',
  ...overrides,
})

function createFakeSupabase({ missingTable = false, quotaOn = null, statsRow = true, turnstile = null } = {}) {
  const state = {
    signatures: [],
    nextId: 1,
    stats: statsRow ? { id: 1, total_count: 0, public_count: 0 } : null,
    limits: new Map(),
    requests: [],
  }

  function singleResponse(row) {
    if (!row) return Response.json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, { status: 406 })
    return Response.json(row)
  }

  async function fetch(input, init = {}) {
    const url = new URL(String(input))
    state.requests.push({ url: url.toString(), method: init.method ?? 'GET' })

    if (url.origin + url.pathname === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      if (turnstile instanceof Error) throw turnstile
      return Response.json(turnstile ?? { success: false })
    }

    if (!url.toString().startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      return Response.json({ message: 'not found' }, { status: 404 })
    }
    if (init.headers?.apikey !== SERVICE_KEY && init.headers?.Authorization !== `Bearer ${SERVICE_KEY}`) {
      return Response.json({ message: 'Invalid API key' }, { status: 401 })
    }

    const table = url.pathname.replace('/rest/v1/', '')
    const params = url.searchParams
    if (missingTable) {
      return Response.json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 })
    }
    if (quotaOn === table || quotaOn === '*') {
      return Response.json({ message: 'database quota exceeded: too many rows' }, { status: 500 })
    }
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null

    if (table === 'petition_stats') {
      if (method === 'GET') return singleResponse(state.stats)
      return Response.json({ message: 'method not allowed' }, { status: 405 })
    }

    if (table === 'signatures') {
      if (method === 'GET') {
        let rows = [...state.signatures]
        if (params.get('is_public')?.startsWith('eq.')) {
          const wanted = Number(params.get('is_public').slice(3))
          rows = rows.filter((row) => row.is_public === wanted)
        }
        if (params.get('role')?.startsWith('eq.')) {
          const wanted = params.get('role').slice(3)
          rows = rows.filter((row) => row.role === wanted)
        }
        if (params.get('id')?.startsWith('gt.')) {
          const after = Number(params.get('id').slice(3))
          rows = rows.filter((row) => row.id > after)
        }
        const total = rows.length
        const order = params.get('order') ?? 'id.asc'
        rows.sort((a, b) => (order === 'id.desc' ? b.id - a.id : a.id - b.id))
        const limit = params.get('limit')
        if (limit) rows = rows.slice(0, Number(limit))
        const headers = {}
        if ((init.headers?.Prefer ?? '').includes('count=exact')) {
          headers['Content-Range'] = `0-${Math.max(0, rows.length - 1)}/${total}`
          headers['Content-Type'] = 'application/json'
          return new Response(JSON.stringify(rows), { status: 200, headers })
        }
        return Response.json(rows)
      }
      if (method === 'POST') {
        if (state.signatures.some((row) => row.email === body.email)) {
          return Response.json(
            { code: '23505', message: 'duplicate key value violates unique constraint "signatures_email_key"' },
            { status: 409 },
          )
        }
        if (state.signatures.some((row) => row.withdrawal_hash === body.withdrawal_hash)) {
          return Response.json(
            { code: '23505', message: 'duplicate key value violates unique constraint "signatures_withdrawal_hash_key"' },
            { status: 409 },
          )
        }
        const row = { id: state.nextId++, ...body }
        state.signatures.push(row)
        if (state.stats) {
          state.stats.total_count += 1
          state.stats.public_count += body.is_public ? 1 : 0
        }
        return new Response('', { status: 201 })
      }
      if (method === 'DELETE') {
        const hash = (params.get('withdrawal_hash') ?? '').replace(/^eq\./, '')
        const kept = []
        const deleted = []
        for (const row of state.signatures) {
          if (row.withdrawal_hash === hash) {
            deleted.push(row)
            if (state.stats) {
              state.stats.total_count -= 1
              state.stats.public_count -= row.is_public ? 1 : 0
            }
          } else {
            kept.push(row)
          }
        }
        state.signatures = kept
        return Response.json(deleted)
      }
    }

    if (table === 'request_limits') {
      if (method === 'DELETE') {
        const before = Number((params.get('expires_at') ?? '').replace(/^lte\./, ''))
        for (const [bucket, row] of state.limits) {
          if (row.expires_at <= before) state.limits.delete(bucket)
        }
        return new Response(null, { status: 204 })
      }
      if (method === 'GET') {
        const bucket = (params.get('bucket') ?? '').replace(/^eq\./, '')
        const row = state.limits.get(bucket) ?? null
        if ((init.headers?.Accept ?? '').includes('object+json')) return singleResponse(row)
        return Response.json(row ? [row] : [])
      }
      if (method === 'POST') {
        state.limits.set(body.bucket, { bucket: body.bucket, attempts: body.attempts, expires_at: body.expires_at })
        return new Response('', { status: 201 })
      }
      if (method === 'PATCH') {
        const bucket = (params.get('bucket') ?? '').replace(/^eq\./, '')
        const row = state.limits.get(bucket)
        if (row) state.limits.set(bucket, { ...row, attempts: body.attempts, expires_at: body.expires_at })
        return new Response(null, { status: 204 })
      }
    }

    return Response.json({ message: 'not found' }, { status: 404 })
  }

  return { state, fetch }
}

function setup(t, { env = {}, fake = {}, dependencies = {} } = {}) {
  const supabase = createFakeSupabase(fake)
  const fullEnv = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...env }
  const deps = { fetch: supabase.fetch, ...dependencies }
  const request = (path, body, headers = {}) =>
    new Request(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const call = async (path, body, headers = {}, extraDeps) => {
    const response = await handleApi(request(path, body, headers), fullEnv, {}, { ...deps, ...extraDeps })
    const contentType = response.headers.get('content-type') ?? ''
    const data = contentType.includes('application/json') ? await response.json() : await response.text()
    return { status: response.status, data, response }
  }
  return { ...supabase, env: fullEnv, deps, request, call }
}

test('Supabase : sans configuration, erreur explicite et jamais de compteur inventé', async () => {
  const missing = await handleApi(new Request(base + '/api/petition'), {})
  assert.equal(missing.status, 503)
  const data = await missing.json()
  assert.equal(data.code, 'DB_NOT_CONFIGURED')
  assert.match(data.error, /SUPABASE_URL/)
  assert.match(data.error, /SUPABASE_SERVICE_ROLE_KEY/)
})

test('Supabase : compteur nul, sans cache, sans CORS et sans soutien inventé', async (t) => {
  const { call } = setup(t, { env: { SIGNATURE_GOAL: '500' } })
  const { data, status, response } = await call('/api/petition')
  assert.equal(status, 200)
  assert.deepEqual(data, {
    count: 0,
    goal: 500,
    publicCount: 0,
    supporters: [],
    roleCounts: { eleve: 0, personnel: 0, parent: 0, ancien: 0, soutien: 0 },
    turnstileSiteKey: null,
  })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  const health = await call('/api/health')
  assert.equal(health.data.storage, 'supabase')
  assert.equal(health.data.count, 0)
})

test('Supabase : signature enregistrée, consentement et code de retrait haché', async (t) => {
  const { call, state } = setup(t)
  const { data, status } = await call('/api/signatures', valid())
  assert.equal(status, 201)
  assert.equal(data.count, 1)
  assert.equal(data.firstName, 'Camille')
  assert.match(data.withdrawalCode, /^[\w-]{32}$/)
  assert.equal(state.signatures.length, 1)
  assert.equal(state.signatures[0].consent_version, '2026-10-13-v1')
  assert.match(state.signatures[0].withdrawal_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(state.signatures[0].withdrawal_hash, data.withdrawalCode)
  assert.equal((await call('/api/petition')).data.publicCount, 0)
})

test('Supabase : données publiques limitées, coordonnées et messages jamais exposés', async (t) => {
  const { call } = setup(t)
  await call('/api/signatures', valid({ lastName: 'Éléonore', isPublic: true, message: 'Message privé' }))
  await call('/api/signatures', valid({ email: 'autre@example.test', firstName: 'Autre' }))
  const { data } = await call('/api/petition')
  assert.equal(data.count, 2)
  assert.equal(data.publicCount, 1)
  assert.equal(data.supporters[0].lastInitial, 'É')
  assert.deepEqual(Object.keys(data.supporters[0]), ['firstName', 'lastInitial', 'role', 'createdAt'])
  const text = JSON.stringify(data)
  for (const secret of ['Éléonore', 'camille@example.test', 'Message privé', 'withdrawal_hash']) {
    assert.ok(!text.includes(secret))
  }
})

test('Supabase : adresses normalisées et doublons rejetés (409, compteur inchangé)', async (t) => {
  const { call } = setup(t)
  assert.equal((await call('/api/signatures', valid())).status, 201)
  const duplicate = await call('/api/signatures', valid({ email: ' CAMILLE@example.test ' }))
  assert.equal(duplicate.status, 409)
  assert.ok(duplicate.data.fields.email)
  assert.equal((await call('/api/petition')).data.count, 1)
})

test('Supabase : validation serveur stricte et champ anti-robot', async (t) => {
  const { call, state } = setup(t)
  const result = await call(
    '/api/signatures',
    valid({ firstName: '<script>', email: 'invalide', role: 'admin', message: 'x'.repeat(1001), consent: 'true' }),
  )
  assert.equal(result.status, 422)
  assert.ok(result.data.fields.consent)
  assert.ok(result.data.fields.email)
  assert.equal((await call('/api/signatures', valid({ website: 'robot.test' }))).status, 400)
  assert.equal(state.signatures.length, 0)
})

test('Supabase : origines étrangères et méthodes inconnues rejetées', async (t) => {
  const { call } = setup(t)
  assert.equal((await call('/api/signatures', valid(), { origin: 'https://evil.example.test' })).status, 403)
  assert.equal((await call('/api/signatures', valid(), { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await call('/api/inconnue')).status, 404)
  const response = await handleApi(new Request(base + '/api/signatures'), { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'POST')
  assert.equal((await call('/api/signatures', valid(), { origin: base })).status, 201)
})

test('Supabase : taille limitée, JSON invalide et mauvais Content-Type', async (t) => {
  const { env, deps } = setup(t)
  const post = (body, headers) =>
    handleApi(new Request(base + '/api/signatures', { method: 'POST', body, headers }), env, {}, deps)
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post('{', { 'Content-Type': 'application/json' })).status, 400)
  assert.equal((await post('[]', { 'Content-Type': 'application/json' })).status, 400)
  assert.equal((await post(JSON.stringify({ message: 'é'.repeat(8000) }), { 'Content-Type': 'application/json' })).status, 413)
})

test('Supabase : tables manquantes = erreur explicite, jamais de faux succès', async (t) => {
  const { call } = setup(t, { fake: { missingTable: true } })
  const petition = await call('/api/petition')
  assert.equal(petition.status, 503)
  assert.equal(petition.data.code, 'SUPABASE_NOT_INITIALIZED')
  const sign = await call('/api/signatures', valid())
  assert.equal(sign.status, 503)
  assert.equal(sign.data.code, 'SUPABASE_NOT_INITIALIZED')
})

test('Supabase : compteur absent = pas de signature sans reçu', async (t) => {
  const { call, state } = setup(t, { fake: { statsRow: false } })
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'SUPABASE_NOT_INITIALIZED')
  assert.equal(state.signatures.length, 0)
})

test('Supabase : quota dépassé = 503 explicite, sans écriture partielle', async (t) => {
  const { call, state } = setup(t, { fake: { quotaOn: 'signatures' } })
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'FREE_QUOTA_REACHED')
  assert.equal(state.signatures.length, 0)
})

test('Supabase : limite anti-abus, IP pseudonymisées et expiration', async (t) => {
  const { call, state } = setup(t, {
    env: { SIGNATURE_RATE_LIMIT: '1', SIGNATURE_RATE_SECRET: 'secret-de-test-non-production' },
  })
  const headers = { 'CF-Connecting-IP': '192.0.2.10' }
  const clock = { now: () => 1_800_000_000_000 }
  assert.equal((await call('/api/signatures', valid(), headers, clock)).status, 201)
  const limited = await call('/api/signatures', valid({ email: 'deux@example.test' }), headers, clock)
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  assert.equal(state.limits.size, 1)
  const [bucket, row] = [...state.limits.entries()][0]
  assert.match(bucket, /^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(row).includes('192.0.2.10'))
  assert.equal(
    (await call('/api/signatures', valid({ email: 'deux@example.test' }), headers, { now: () => clock.now() + 601_000 })).status,
    201,
  )
  assert.equal(state.limits.size, 1)
})

test('Supabase : retrait complet puis réinscription possible', async (t) => {
  const { call, state } = setup(t)
  const signed = await call('/api/signatures', valid({ isPublic: true }))
  const result = await call('/api/signatures/withdraw', { withdrawalCode: signed.data.withdrawalCode })
  assert.equal(result.status, 200)
  assert.equal(result.data.count, 0)
  assert.equal(result.data.withdrawn, true)
  assert.equal(state.signatures.length, 0)
  assert.equal((await call('/api/petition')).data.publicCount, 0)
  assert.equal((await call('/api/signatures/withdraw', { withdrawalCode: signed.data.withdrawalCode })).status, 404)
  assert.equal((await call('/api/signatures/withdraw', { withdrawalCode: 'trop-court' })).status, 422)
  assert.equal((await call('/api/signatures', valid())).status, 201)
})

test('Supabase : export privé paginé, protégé des formules, sans référence de retrait', async (t) => {
  const admin = setup(t, { env: { ADMIN_TOKEN: 't'.repeat(48), SIGNATURE_RATE_LIMIT: '1000' } })
  assert.equal((await setup(t).call('/api/admin/signatures.csv')).status, 503)
  assert.equal((await admin.call('/api/admin/signatures.csv')).status, 401)
  assert.equal((await admin.call('/api/admin/signatures.csv?token=' + 't'.repeat(48))).status, 401)

  for (let i = 0; i < 251; i++) {
    await admin.call(
      '/api/signatures',
      valid({
        firstName: i === 0 ? '=FORMULE' : `Camille ${i}`,
        email: `test-${i}@example.test`,
        message: i === 0 ? '@message\nmultiligne' : '',
      }),
    )
  }
  const headers = { Authorization: `Bearer ${'t'.repeat(48)}` }
  const first = await handleApi(
    new Request(base + '/api/admin/signatures.csv', { headers }),
    admin.env,
    {},
    admin.deps,
  )
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('X-Export-Count'), '250')
  assert.equal(first.headers.get('X-Export-Complete'), 'false')
  const csv = await first.text()
  assert.ok(csv.includes("'=FORMULE"))
  assert.ok(csv.includes("'@message"))
  assert.ok(!csv.includes('withdrawal_hash'))
  const next = first.headers.get('X-Next-Cursor')
  assert.ok(next)
  const second = await handleApi(
    new Request(`${base}/api/admin/signatures.csv?after=${next}`, { headers }),
    admin.env,
    {},
    admin.deps,
  )
  assert.equal(second.headers.get('X-Export-Complete'), 'true')
  assert.equal(second.headers.get('X-Export-Count'), '1')
  assert.ok((await second.text()).includes('test-250@example.test'))
})

test('Supabase : Turnstile requis quand configuré, secret jamais exposé', async (t) => {
  const { call } = setup(t, { env: { TURNSTILE_SITE_KEY: 'site-test', TURNSTILE_SECRET_KEY: 'secret-test' } })
  const missing = await call('/api/signatures', valid())
  assert.equal(missing.status, 422)
  assert.ok(missing.data.fields.turnstile)
  const publicData = (await call('/api/petition')).data
  assert.equal(publicData.turnstileSiteKey, 'site-test')
  assert.ok(!JSON.stringify(publicData).includes('secret-test'))
})

test('Supabase : Turnstile mal configuré = 503, jamais de protection silencieuse', async (t) => {
  const { call } = setup(t, { env: { TURNSTILE_SECRET_KEY: 'secret-test' } })
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'TURNSTILE_NOT_CONFIGURED')
})

test('Supabase : Turnstile vérifie le succès, l’action et le nom d’hôte', async (t) => {
  const local = setup(t, {
    env: { TURNSTILE_SITE_KEY: 'site-test', TURNSTILE_SECRET_KEY: 'secret-test' },
  })
  for (const verification of [
    { success: false },
    { success: true, action: 'mauvaise', hostname: 'petition.example.test' },
    { success: true, action: 'sign_petition', hostname: 'evil.example.test' },
  ]) {
    const attempt = await local.call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, {
      fetch: async (input, init) => {
        if (String(input).includes('challenges.cloudflare.com')) return Response.json(verification)
        return local.fetch(input, init)
      },
    })
    assert.equal(attempt.status, 422)
    assert.ok(attempt.data.fields.turnstile)
  }
  assert.equal(local.state.signatures.length, 0)
  assert.equal((await local.call('/api/petition')).data.count, 0)
})

test('Supabase : panne Turnstile = aucun enregistrement, succès = signature', async (t) => {
  const local = setup(t, { env: { TURNSTILE_SITE_KEY: 'site-test', TURNSTILE_SECRET_KEY: 'secret-test' } })
  const offline = await local.call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, {
    fetch: async (input, init) => {
      if (String(input).includes('challenges.cloudflare.com')) throw new Error('offline')
      return local.fetch(input, init)
    },
  })
  assert.equal(offline.status, 503)
  assert.equal(local.state.signatures.length, 0)

  const ok = await local.call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, {
    fetch: async (input, init) => {
      if (String(input).includes('challenges.cloudflare.com')) {
        assert.equal(String(input), 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
        assert.equal(init.body.get('secret'), 'secret-test')
        return Response.json({ success: true, action: 'sign_petition', hostname: 'petition.example.test' })
      }
      return local.fetch(input, init)
    },
  })
  assert.equal(ok.status, 201)
  assert.equal(ok.data.count, 1)
})

test('Supabase : URL dérivée de DATABASE_URL quand SUPABASE_URL est absent', async (t) => {
  const { state } = setup(t)
  void state
  const supabase = createFakeSupabase({})
  let seenUrl = ''
  const watchingFetch = async (input, init = {}) => {
    seenUrl = String(input)
    const rewritten = seenUrl.replace(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
      `${SUPABASE_URL}/rest/v1/`,
    )
    return supabase.fetch(rewritten, init)
  }
  const response = await handleApi(
    new Request(base + '/api/petition'),
    {
      DATABASE_URL: 'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    },
    {},
    { fetch: watchingFetch },
  )
  assert.equal(response.status, 200)
  assert.ok(seenUrl.startsWith('https://abcdefghijklmnopqrst.supabase.co/rest/v1/'), seenUrl)
})

test('Supabase : la clé alias SUPABASE_SERVICE_KEY est acceptée', async () => {
  const supabase = createFakeSupabase({})
  const response = await handleApi(
    new Request(base + '/api/health'),
    { SUPABASE_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY },
    {},
    { fetch: supabase.fetch },
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).storage, 'supabase')
})

test('Supabase : chaque catégorie affiche ses 50 derniers soutiens avec son compteur', async (t) => {
  const { call } = setup(t)
  for (let i = 0; i < 3; i++) {
    const signed = await call('/api/signatures', valid({ firstName: `Staf${i}`, email: `staf${i}@example.test`, role: 'personnel', isPublic: true }))
    assert.equal(signed.status, 201)
  }
  for (let i = 0; i < 51; i++) {
    const signed = await call('/api/signatures', valid({ firstName: `Eleve${i}`, email: `eleve${i}@example.test`, role: 'eleve', isPublic: true }))
    assert.equal(signed.status, 201)
  }
  await call('/api/signatures', valid({ firstName: 'Prive', email: 'prive@example.test', role: 'parent', isPublic: false }))
  const staff = await call('/api/supporters?role=personnel')
  assert.equal(staff.status, 200)
  assert.equal(staff.data.supporters.length, 3)
  assert.equal(staff.data.total, 3)
  const pupils = await call('/api/supporters?role=eleve')
  assert.equal(pupils.data.supporters.length, 50)
  assert.equal(pupils.data.total, 51)
  assert.equal(pupils.data.supporters[0].firstName, 'Eleve50')
  const all = await call('/api/supporters')
  assert.equal(all.data.supporters.length, 50)
  assert.equal(all.data.total, 54)
  const parents = await call('/api/supporters?role=parent')
  assert.equal(parents.data.supporters.length, 0)
  assert.equal(parents.data.total, 0)
  assert.equal((await call('/api/supporters?role=admin')).status, 422)
  const petition = await call('/api/petition')
  assert.deepEqual(petition.data.roleCounts, { eleve: 51, personnel: 3, parent: 0, ancien: 0, soutien: 0 })
})
