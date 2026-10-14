import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { handleApi } from './api.mjs'
import { createTestD1 } from '../tests/helpers/d1-sqlite.mjs'
import { publicMetadata } from '../shared/metadata.mjs'

const base = 'https://petition.example.test'
const valid = (overrides = {}) => ({ firstName: 'Camille', lastName: 'Laurent', email: 'camille@example.test', role: 'eleve', message: '', consent: true, isPublic: false, website: '', ...overrides })
function setup(t, options = {}) {
  const storage = createTestD1(options)
  t.after(storage.close)
  const env = { DB: storage.db, ...options.env }
  const request = (path, body, headers = {}) => new Request(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const call = async (path, body, headers = {}, dependencies) => {
    const response = await handleApi(request(path, body, headers), env, {}, dependencies)
    return { status: response.status, data: await response.json(), response }
  }
  return { ...storage, env, request, call }
}

test('D1 : compteur nul, réponses non mises en cache et aucun soutien inventé', async (t) => {
  const { call } = setup(t, { env: { SIGNATURE_GOAL: '500', CONTACT_EMAIL: 'collectif@example.test' } })
  const { data, status, response } = await call('/api/petition')
  assert.equal(status, 200)
  assert.deepEqual(data, { count: 0, goal: 500, publicCount: 0, supporters: [], contactEmail: 'collectif@example.test', turnstileSiteKey: null })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal((await call('/api/health')).data.storage, 'd1')
})

test('D1 : consentement enregistré, token privé haché et compteur atomique', async (t) => {
  const { call, sqlite } = setup(t)
  const { data, status } = await call('/api/signatures', valid())
  assert.equal(status, 201)
  assert.equal(data.count, 1)
  assert.match(data.withdrawalCode, /^[\w-]{32}$/)
  const row = sqlite.prepare('SELECT * FROM signatures').get()
  assert.equal(row.consent_version, '2026-10-13-v1')
  assert.notEqual(row.withdrawal_hash, data.withdrawalCode)
  assert.match(row.withdrawal_hash, /^[a-f0-9]{64}$/)
  assert.equal((await call('/api/petition')).data.publicCount, 0)
})

test('D1 : données publiques limitées au prénom, initiale, profil et date', async (t) => {
  const { call } = setup(t)
  await call('/api/signatures', valid({ lastName: 'Éléonore', isPublic: true, message: 'Message privé' }))
  await call('/api/signatures', valid({ email: 'autre@example.test', firstName: 'Autre' }))
  const { data } = await call('/api/petition')
  assert.equal(data.count, 2)
  assert.equal(data.publicCount, 1)
  assert.equal(data.supporters[0].lastInitial, 'É')
  assert.deepEqual(Object.keys(data.supporters[0]), ['firstName', 'lastInitial', 'role', 'createdAt'])
  const json = JSON.stringify(data)
  for (const privateValue of ['Éléonore', 'camille@example.test', 'Message privé', 'withdrawal_hash']) assert.ok(!json.includes(privateValue))
})

test('D1 : adresses normalisées et doublons rejetés, y compris simultanés', async (t) => {
  const { call } = setup(t)
  const attempts = await Promise.all([
    call('/api/signatures', valid()), call('/api/signatures', valid({ email: ' CAMILLE@example.test ' })),
  ])
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409])
  assert.equal((await call('/api/petition')).data.count, 1)
})

test('D1 : validation serveur stricte, même sans validation du navigateur', async (t) => {
  const { call, sqlite } = setup(t)
  const result = await call('/api/signatures', valid({ firstName: '<script>', email: 'invalide', role: 'admin', message: 'x'.repeat(1001), consent: 'true' }))
  assert.equal(result.status, 422)
  assert.ok(result.data.fields.consent)
  assert.equal((await call('/api/signatures', valid({ website: 'robot.test' }))).status, 400)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 0)
})

test('D1 : protection contre les requêtes cross-origin et méthodes inconnues', async (t) => {
  const { call, env } = setup(t)
  assert.equal((await call('/api/signatures', valid(), { origin: 'https://evil.example.test' })).status, 403)
  assert.equal((await call('/api/signatures', valid(), { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await call('/api/inconnue')).status, 404)
  const response = await handleApi(new Request(base + '/api/signatures'), env)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'POST')
  assert.equal((await call('/api/signatures', valid(), { origin: base })).status, 201)
})

test('D1 : limite réelle de taille, JSON invalide et mauvais Content-Type', async (t) => {
  const { env } = setup(t)
  const post = (body, headers) => handleApi(new Request(base + '/api/signatures', { method: 'POST', body, headers }), env)
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post('{', { 'Content-Type': 'application/json' })).status, 400)
  assert.equal((await post('[]', { 'Content-Type': 'application/json' })).status, 400)
  assert.equal((await post(JSON.stringify({ message: 'é'.repeat(8000) }), { 'Content-Type': 'application/json' })).status, 413)
})

test('D1 : absence de liaison ou de migration = erreur, jamais faux compteur ou succès', async (t) => {
  const missing = await handleApi(new Request(base + '/api/petition'), {})
  assert.equal(missing.status, 503)
  assert.equal((await missing.json()).code, 'DB_NOT_CONFIGURED')
  const { call } = setup(t, { initialize: false })
  const uninitialized = await call('/api/signatures', valid())
  assert.equal(uninitialized.status, 503)
  assert.equal(uninitialized.data.code, 'D1_NOT_INITIALIZED')
})

test('D1 : un compteur absent n’enregistre pas une signature sans reçu', async (t) => {
  const { call, sqlite } = setup(t)
  sqlite.exec('DELETE FROM petition_stats')
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'D1_NOT_INITIALIZED')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 0)
})

test('D1 : erreur de quota dans une transaction = rollback, pas de données orphelines', async (t) => {
  const { call, sqlite } = setup(t, { failQuery: (sql) => {
    if (sql.startsWith('SELECT total_count AS count FROM')) throw new Error('D1 daily read quota exceeded')
  } })
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'FREE_QUOTA_REACHED')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 0)
  assert.equal(sqlite.prepare('SELECT total_count FROM petition_stats').get().total_count, 0)
})

test('D1 : limite distribuée, pseudonymisation des IP et expiration des compteurs', async (t) => {
  const { call, sqlite } = setup(t, { env: { SIGNATURE_RATE_LIMIT: '1', SIGNATURE_RATE_SECRET: 'secret-de-test-non-production' } })
  const headers = { 'CF-Connecting-IP': '192.0.2.10' }
  const clock = { now: () => 1_800_000_000_000 }
  assert.equal((await call('/api/signatures', valid(), headers, clock)).status, 201)
  const limited = await call('/api/signatures', valid({ email: 'deux@example.test' }), headers, clock)
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  const row = sqlite.prepare('SELECT * FROM request_limits').get()
  assert.match(row.bucket, /^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(row).includes('192.0.2.10'))
  assert.equal((await call('/api/signatures', valid({ email: 'deux@example.test' }), headers, { now: () => clock.now() + 601_000 })).status, 201)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM request_limits').get().count, 1)
})

test('D1 : retrait complet et réinscription possible avec la même adresse', async (t) => {
  const { call, sqlite } = setup(t)
  const signed = await call('/api/signatures', valid({ isPublic: true }))
  const result = await call('/api/signatures/withdraw', { withdrawalCode: signed.data.withdrawalCode })
  assert.equal(result.status, 200)
  assert.equal(result.data.count, 0)
  assert.equal((await call('/api/petition')).data.publicCount, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 0)
  assert.equal((await call('/api/signatures/withdraw', { withdrawalCode: signed.data.withdrawalCode })).status, 404)
  assert.equal((await call('/api/signatures', valid())).status, 201)
})

test('D1 : index public et triggers de compteur sans scan par visite', async (t) => {
  const { call, sqlite } = setup(t)
  await call('/api/signatures', valid())
  sqlite.prepare('UPDATE signatures SET is_public = 1').run()
  assert.equal((await call('/api/petition')).data.publicCount, 1)
  const plan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT * FROM signatures WHERE is_public = 1 ORDER BY id DESC LIMIT 50').all()
  assert.ok(JSON.stringify(plan).includes('signatures_public_recent'))
})

test('D1 : migration réexécutable sans perte des signatures ni remise à zéro', async (t) => {
  const { call, sqlite, migration } = setup(t)
  await call('/api/signatures', valid({ isPublic: true }))
  sqlite.exec(migration)
  assert.equal((await call('/api/petition')).data.count, 1)
  await call('/api/signatures', valid({ email: 'deux@example.test' }))
  assert.equal((await call('/api/petition')).data.count, 2)
})

test('D1 : export désactivé par défaut et authentification privée obligatoire', async (t) => {
  const storage = setup(t)
  assert.equal((await storage.call('/api/admin/signatures.csv')).status, 503)
  storage.env.ADMIN_TOKEN = 't'.repeat(48)
  assert.equal((await storage.call('/api/admin/signatures.csv')).status, 401)
  assert.equal((await storage.call('/api/admin/signatures.csv?token=' + storage.env.ADMIN_TOKEN)).status, 401)
  assert.equal((await storage.call('/api/admin/signatures.csv', undefined, { Authorization: 'Bearer incorrect' })).status, 401)
})

function seed(sqlite, count) {
  const insert = sqlite.prepare(`INSERT INTO signatures (first_name, last_name, email, message, consent_version, created_at, withdrawal_hash)
    VALUES (?, 'Laurent', ?, ?, 'test', '2026-10-13T12:00:00Z', ?)`)
  for (let i = 0; i < count; i++) insert.run(i === 0 ? '=FORMULE' : `Camille ${i}`, `test-${i}@example.test`, i === 0 ? '@message\nmultiligne' : '', `test-hash-${i}`)
}

test('D1 : export paginé et protégé des formules, sans référence de retrait', async (t) => {
  const { env, request, sqlite } = setup(t, { env: { ADMIN_TOKEN: 't'.repeat(48) } })
  seed(sqlite, 251)
  const headers = { Authorization: `Bearer ${env.ADMIN_TOKEN}` }
  const first = await handleApi(request('/api/admin/signatures.csv', undefined, headers), env)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('X-Export-Count'), '250')
  assert.equal(first.headers.get('X-Export-Complete'), 'false')
  const csv = await first.text()
  assert.ok(csv.includes("'=FORMULE"))
  assert.ok(csv.includes("'@message"))
  assert.ok(!csv.includes('test-hash-'))
  const next = first.headers.get('X-Next-Cursor')
  const second = await handleApi(request('/api/admin/signatures.csv?after=' + next, undefined, headers), env)
  assert.equal(second.headers.get('X-Export-Complete'), 'true')
  assert.equal(second.headers.get('X-Export-Count'), '1')
  assert.ok((await second.text()).includes('test-250@example.test'))
  assert.equal((await handleApi(request('/api/admin/signatures.csv?after=-1', undefined, headers), env)).status, 422)
})

const turnstileEnv = { TURNSTILE_SITE_KEY: 'site-test', TURNSTILE_SECRET_KEY: 'secret-test' }
test('Turnstile : token requis et secret jamais divulgué', async (t) => {
  const { call } = setup(t, { env: turnstileEnv })
  const missing = await call('/api/signatures', valid())
  assert.equal(missing.status, 422)
  assert.ok(missing.data.fields.turnstile)
  const publicData = (await call('/api/petition')).data
  assert.equal(publicData.turnstileSiteKey, 'site-test')
  assert.ok(!JSON.stringify(publicData).includes('secret-test'))
})

test('Turnstile : une clé manquante ne désactive jamais silencieusement la protection', async (t) => {
  const { call } = setup(t, { env: { TURNSTILE_SECRET_KEY: 'secret-test' } })
  const result = await call('/api/signatures', valid())
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'TURNSTILE_NOT_CONFIGURED')
})

test('Turnstile : validation côté serveur du hostname et de l’action', async (t) => {
  const { call } = setup(t, { env: turnstileEnv })
  for (const result of [
    { success: false }, { success: true, action: 'wrong', hostname: 'petition.example.test' },
    { success: true, action: 'sign_petition', hostname: 'evil.example.test' },
  ]) {
    assert.equal((await call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, { fetch: async () => Response.json(result) })).status, 422)
  }
  assert.equal((await call('/api/petition')).data.count, 0)
})

test('Turnstile : panne du service = aucun enregistrement, résultat valide = signature', async (t) => {
  const { call } = setup(t, { env: turnstileEnv })
  assert.equal((await call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, { fetch: async () => { throw new Error('offline') } })).status, 503)
  const result = await call('/api/signatures', valid({ turnstileToken: 'token-test' }), {}, {
    fetch: async (url, options) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
      assert.equal(options.body.get('secret'), 'secret-test')
      return Response.json({ success: true, action: 'sign_petition', hostname: 'petition.example.test' })
    },
  })
  assert.equal(result.status, 201)
  assert.equal(result.data.count, 1)
})

test('Métadonnées de partage absolues, sans double canonical ni URL invalide', () => {
  const html = '<head><meta property="og:image" content="/assets/partage.png" /></head>'
  const output = publicMetadata(html, 'https://petition.example.test')
  assert.ok(output.includes('https://petition.example.test/assets/partage.png'))
  assert.equal(publicMetadata(output, 'https://petition.example.test'), output)
  assert.equal(publicMetadata(html, 'javascript:alert(1)'), html)
})

test('Export CLI : tous les lots, un seul en-tête et fichier privé', async (t) => {
  const { env, sqlite } = setup(t, { env: { ADMIN_TOKEN: 't'.repeat(48) } })
  seed(sqlite, 251)
  const directory = await mkdtemp(join(tmpdir(), 'leborgne-export-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const server = createServer(async (req, res) => {
    const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { headers: req.headers })
    const response = await handleApi(request, env)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise((done) => server.close(done)))
  const outputPath = join(directory, 'signatures.csv')
  const child = spawn(process.execPath, [resolve('scripts/export-signatures.mjs'), outputPath], {
    env: { ...process.env, PUBLIC_URL: `http://127.0.0.1:${server.address().port}`, ADMIN_TOKEN: env.ADMIN_TOKEN },
  })
  let logs = ''
  child.stdout.on('data', (data) => logs += data)
  child.stderr.on('data', (data) => logs += data)
  const exit = await new Promise((done) => child.on('close', done))
  assert.equal(exit, 0, logs)
  const csv = await readFile(outputPath, 'utf8')
  assert.equal((csv.match(/"Prénom";"Nom"/g) ?? []).length, 1)
  assert.ok(csv.includes('test-250@example.test'))
  assert.ok(logs.includes('251 signatures'))
  assert.ok(!logs.includes(env.ADMIN_TOKEN))
})
