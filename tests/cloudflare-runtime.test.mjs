import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCloudflareRuntime } from './helpers/cloudflare-runtime.mjs'

// Test d’intégration : le VRAI bundle Pages Functions (construit par
// `npm run cloudflare:build`) exécuté dans Miniflare avec une base D1.
// Lancez via `npm run test:cloudflare`.
if (!existsSync(resolve('.cache/pages-functions/index.js'))) {
  throw new Error('Bundle Cloudflare introuvable : lancez `npm run test:cloudflare` (build inclus).')
}

const base = 'https://petition.example.test'
const valid = (overrides = {}) => ({
  firstName: 'Camille',
  lastName: 'Laurent',
  email: 'camille@example.test',
  role: 'eleve',
  message: '',
  consent: true,
  isPublic: true,
  website: '',
  ...overrides,
})

async function setup(t, bindings = {}) {
  const runtime = await createCloudflareRuntime({
    bindings: { SIGNATURE_GOAL: '1000', ...bindings },
  })
  t.after(runtime.close)
  const call = async (path, body, headers = {}) => {
    const response = await runtime.fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, data: await response.json(), response }
  }
  return { ...runtime, call }
}

test('Runtime Cloudflare : santé, compteur et parcours complet de signature', async (t) => {
  const { call } = await setup(t)
  const health = await call('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.data.storage, 'd1')

  const empty = await call('/api/petition')
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.data, {
    count: 0,
    goal: 1000,
    publicCount: 0,
    supporters: [],
    roleCounts: { eleve: 0, personnel: 0, parent: 0, ancien: 0, soutien: 0 },
    turnstileSiteKey: null,
  })
  assert.equal(empty.response.headers.get('cache-control'), 'no-store')

  const signed = await call('/api/signatures', valid())
  assert.equal(signed.status, 201)
  assert.equal(signed.data.count, 1)
  assert.match(signed.data.withdrawalCode, /^[\w-]{32}$/)

  const duplicate = await call('/api/signatures', valid())
  assert.equal(duplicate.status, 409)

  const petition = await call('/api/petition')
  assert.equal(petition.data.count, 1)
  assert.equal(petition.data.publicCount, 1)
  assert.equal(petition.data.supporters[0].firstName, 'Camille')
  assert.equal(petition.data.supporters[0].lastInitial, 'L')

  const withdrawn = await call('/api/signatures/withdraw', { withdrawalCode: signed.data.withdrawalCode })
  assert.equal(withdrawn.status, 200)
  assert.equal(withdrawn.data.count, 0)
  assert.equal(withdrawn.data.withdrawn, true)
  assert.equal((await call('/api/petition')).data.count, 0)
})

test('Runtime Cloudflare : routes inconnues, méthodes et export protégé', async (t) => {
  const { call, fetch } = await setup(t, { ADMIN_TOKEN: 't'.repeat(48) })
  assert.equal((await call('/api/inconnue')).status, 404)
  const signed = await call('/api/signatures', valid({ firstName: '=FORMULE' }))
  assert.equal(signed.status, 201)

  const denied = await call('/api/admin/signatures.csv')
  assert.equal(denied.status, 401)

  const csvResponse = await fetch(base + '/api/admin/signatures.csv', {
    headers: { Authorization: `Bearer ${'t'.repeat(48)}` },
  })
  assert.equal(csvResponse.status, 200)
  assert.equal(csvResponse.headers.get('X-Export-Count'), '1')
  assert.equal(csvResponse.headers.get('X-Export-Complete'), 'true')
  const csv = await csvResponse.text()
  assert.ok(csv.includes("'=FORMULE"))
  assert.ok(!csv.includes('withdrawal_hash'))
})
