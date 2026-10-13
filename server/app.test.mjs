import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, CONSENT_VERSION } from './app.mjs'

const valid = (overrides = {}) => ({
  firstName: 'Camille', lastName: 'Laurent', email: 'camille@example.test',
  role: 'eleve', consent: true, isPublic: false, message: '', website: '', ...overrides,
})

async function setup(t, options = {}) {
  const { app, db } = createApp({ databasePath: ':memory:', rateLimits: false, ...options })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    db.close()
  })
  const call = async (path, body, options = {}) => {
    const response = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }
  return { call, db, url }
}

test('Le compteur initial est réel, nul et sans soutiens fictifs', async (t) => {
  const { call } = await setup(t)
  const { status, data } = await call('/api/petition')
  assert.equal(status, 200)
  assert.equal(data.count, 0)
  assert.equal(data.publicCount, 0)
  assert.equal(data.goal, 1000)
  assert.deepEqual(data.supporters, [])
  assert.equal(data.contactEmail, null)
})

test('Signature enregistrée avec consentement et référence de retrait privée', async (t) => {
  const { call, db } = await setup(t)
  const { status, data } = await call('/api/signatures', valid())
  assert.equal(status, 201)
  assert.equal(data.count, 1)
  assert.match(data.withdrawalCode, /^[\w-]{32}$/)
  const row = db.prepare('SELECT * FROM signatures').get()
  assert.equal(row.first_name, 'Camille')
  assert.equal(row.consent_version, CONSENT_VERSION)
  assert.notEqual(row.withdrawal_hash, data.withdrawalCode)
  assert.equal(row.withdrawal_hash.length, 64)
  const publicData = (await call('/api/petition')).data
  assert.equal(publicData.count, 1)
  assert.deepEqual(publicData.supporters, [])
})

test('Seuls les soutiens volontaires sont publics, sans nom complet ni e-mail', async (t) => {
  const { call } = await setup(t)
  await call('/api/signatures', valid({ isPublic: true, message: 'Message confidentiel' }))
  await call('/api/signatures', valid({ firstName: 'Alex', email: 'alex@example.test' }))
  const { data } = await call('/api/petition')
  assert.equal(data.count, 2)
  assert.equal(data.publicCount, 1)
  assert.equal(data.supporters.length, 1)
  assert.equal(data.supporters[0].firstName, 'Camille')
  assert.equal(data.supporters[0].lastInitial, 'L')
  assert.equal(data.supporters[0].role, 'eleve')
  const json = JSON.stringify(data)
  assert.ok(!json.includes('example.test'))
  assert.ok(!json.includes('Laurent'))
  assert.ok(!json.includes('Message confidentiel'))
  assert.ok(!json.includes('withdrawal'))
})

test('Doublons rejetés même avec casse ou espaces dans l’adresse e-mail', async (t) => {
  const { call } = await setup(t)
  assert.equal((await call('/api/signatures', valid())).status, 201)
  const duplicate = await call('/api/signatures', valid({ email: '  CAMILLE@example.test  ' }))
  assert.equal(duplicate.status, 409)
  assert.ok(duplicate.data.fields.email)
  assert.equal((await call('/api/petition')).data.count, 1)
})

test('Validation serveur indépendante du navigateur et du consentement client', async (t) => {
  const { call } = await setup(t)
  const invalid = await call('/api/signatures', valid({ firstName: '<script>', lastName: '', email: 'invalide', consent: false, role: 'admin', message: 'x'.repeat(1001) }))
  assert.equal(invalid.status, 422)
  assert.deepEqual(Object.keys(invalid.data.fields).sort(), ['consent', 'email', 'firstName', 'lastName', 'message', 'role'])
  assert.equal((await call('/api/signatures', valid({ consent: 'true' }))).status, 422)
  assert.equal((await call('/api/signatures', valid({ website: 'spam.test' }))).status, 400)
  assert.equal((await call('/api/signatures', valid(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await call('/api/petition')).data.count, 0)
})

test('Retrait supprime les données, le soutien public et met à jour le compteur', async (t) => {
  const { call, db } = await setup(t)
  const signature = await call('/api/signatures', valid({ isPublic: true }))
  const code = signature.data.withdrawalCode
  assert.equal((await call('/api/signatures/withdraw', { withdrawalCode: 'incorrect' })).status, 422)
  const withdrawal = await call('/api/signatures/withdraw', { withdrawalCode: code })
  assert.equal(withdrawal.status, 200)
  assert.equal(withdrawal.data.count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM signatures').get().total, 0)
  assert.deepEqual((await call('/api/petition')).data.supporters, [])
  assert.equal((await call('/api/signatures/withdraw', { withdrawalCode: code })).status, 404)
  assert.equal((await call('/api/signatures', valid())).status, 201)
})

test('Les noms Unicode sont préservés et les requêtes SQL sont paramétrées', async (t) => {
  const { call, db } = await setup(t)
  assert.equal((await call('/api/signatures', valid({ firstName: '李', lastName: 'Éléonore-D’Artagnan', isPublic: true }))).status, 201)
  assert.equal((await call('/api/petition')).data.supporters[0].lastInitial, 'É')
  assert.equal((await call('/api/signatures', valid({ firstName: "Robert'); DROP TABLE signatures;--", email: 'robert@example.test' }))).status, 201)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM signatures').get().total, 2)
})

test('Export désactivé par défaut, protégé par secret et sûr pour les tableurs', async (t) => {
  const disabled = await setup(t)
  assert.equal((await disabled.call('/api/admin/signatures.csv')).status, 503)
  const token = 'a'.repeat(40)
  const { call, url } = await setup(t, { adminToken: token })
  await call('/api/signatures', valid({ firstName: '=IMPORTXML("url")', message: ' @danger' }))
  assert.equal((await call('/api/admin/signatures.csv')).status, 401)
  assert.equal((await call('/api/admin/signatures.csv', undefined, { headers: { authorization: 'Bearer wrong' } })).status, 401)
  const response = await fetch(url + '/api/admin/signatures.csv', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/csv/)
  const csv = await response.text()
  assert.ok(csv.includes('camille@example.test'))
  assert.ok(csv.includes("'=IMPORTXML"))
  assert.ok(csv.includes("'@danger"))
  assert.ok(!csv.includes('withdrawal_hash'))
})

test('Limitation des tentatives d’envoi pour réduire le spam', async (t) => {
  const { call } = await setup(t, { rateLimits: true, writeLimit: 12 })
  for (let i = 0; i < 12; i++) {
    assert.equal((await call('/api/signatures', valid({ email: `camille-${i}@example.test` }))).status, 201)
  }
  assert.equal((await call('/api/signatures', valid())).status, 429)
  assert.equal((await call('/api/petition')).data.count, 12)
})

test('La base sur disque survit à la fermeture et à la réouverture', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'leborgne-test-'))
  const path = join(dir, 'signatures.sqlite')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const first = createApp({ databasePath: path, rateLimits: false })
  first.db.prepare(`INSERT INTO signatures
    (first_name, last_name, email, consent_version, created_at, withdrawal_hash)
    VALUES (?, ?, ?, ?, ?, ?)`).run('Camille', 'Laurent', 'camille@example.test', CONSENT_VERSION, new Date().toISOString(), 'test-hash')
  first.db.close()
  const second = createApp({ databasePath: path, rateLimits: false })
  assert.equal(second.db.prepare('SELECT COUNT(*) AS total FROM signatures').get().total, 1)
  second.db.close()
})
