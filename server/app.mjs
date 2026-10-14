import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

import { CONSENT_VERSION, cleanText, validEmail, csvCell, validateSignature } from '../shared/petition.mjs'
export { CONSENT_VERSION, ROLES } from '../shared/petition.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')

export function createApp({
  databasePath = './data/signatures.sqlite',
  goal = 1000,
  contactEmail = '',
  adminToken = '',
  trustProxy = 0,
  rateLimits = true,
  writeLimit = 60,
  production = false,
  turnstileSiteKey = '',
  turnstileSecretKey = '',
} = {}) {
  const turnstileSite = String(turnstileSiteKey || '').trim()
  const turnstileSecret = String(turnstileSecretKey || '').trim()
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  }
  const db = new DatabaseSync(databasePath)
  if (databasePath !== ':memory:') chmodSync(databasePath, 0o600)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS signatures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT COLLATE NOCASE NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
      consent_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      withdrawal_hash TEXT NOT NULL UNIQUE
    );
  `)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
    if (production) {
      res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'")
    }
    next()
  })
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', express.json({ limit: '12kb' }))

  if (rateLimits) {
    app.use('/api', rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Trop de demandes. Merci de patienter une minute.' },
    }))
  }
  const writeLimiter = rateLimits ? rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number.isSafeInteger(writeLimit) && writeLimit > 0 ? writeLimit : 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Trop de tentatives depuis cette connexion. Réessayez dans une dizaine de minutes.' },
  }) : (_req, _res, next) => next()

  const countSignatures = () => Number(db.prepare('SELECT COUNT(*) AS count FROM signatures').get().count)
  const milestone = Number.isSafeInteger(Number(goal)) && Number(goal) > 0 ? Number(goal) : 1000

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

  app.get('/api/petition', (_req, res) => {
    const supporters = db.prepare(`
      SELECT first_name AS firstName, substr(last_name, 1, 1) AS lastInitial,
        role, created_at AS createdAt
      FROM signatures WHERE is_public = 1 ORDER BY id DESC LIMIT 50
    `).all()
    const publicCount = Number(db.prepare('SELECT COUNT(*) AS count FROM signatures WHERE is_public = 1').get().count)
    res.json({
      count: countSignatures(),
      goal: milestone,
      publicCount,
      supporters,
      contactEmail: validEmail(contactEmail) ? contactEmail : null,
      turnstileSiteKey: turnstileSite || null,
    })
  })

  const forbiddenOrigin = (req) => {
    if (req.get('sec-fetch-site') === 'cross-site') return true
    const origin = req.get('origin')
    if (!origin) return false
    try {
      return new URL(origin).origin !== `${req.protocol}://${req.get('host')}`
    } catch {
      return true
    }
  }

  const checkTurnstile = async (req, body) => {
    if (!turnstileSite && !turnstileSecret) return null
    if (!turnstileSite || !turnstileSecret) {
      return { status: 503, data: { code: 'TURNSTILE_NOT_CONFIGURED', error: 'La vérification anti-robot est incomplète côté serveur. Merci de réessayer plus tard.' } }
    }
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : ''
    if (!token) {
      return { status: 422, data: { error: 'Validez la vérification anti-robot avant de signer.', fields: { turnstile: 'Validez la vérification anti-robot avant de signer.' } } }
    }
    try {
      const verification = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: turnstileSecret, response: token }),
      })).json()
      if (!verification?.success || verification.action !== 'sign_petition' || verification.hostname !== req.hostname) {
        return { status: 422, data: { error: 'La vérification anti-robot a échoué. Merci de réessayer.', fields: { turnstile: 'La vérification anti-robot a échoué. Merci de réessayer.' } } }
      }
    } catch {
      return { status: 503, data: { error: 'La vérification anti-robot est momentanément indisponible. Merci de réessayer.' } }
    }
    return null
  }

  app.post('/api/signatures', writeLimiter, async (req, res) => {
    if (forbiddenOrigin(req)) {
      return res.status(403).json({ error: 'Merci de signer depuis le site de la pétition.' })
    }
    const body = req.body ?? {}
    const { firstName, lastName, email, role, message, fields } = validateSignature(body)
    if (body.website) return res.status(400).json({ error: 'Envoi non valide.' })
    if (Object.keys(fields).length) {
      return res.status(422).json({ error: 'Vérifiez les informations du formulaire.', fields })
    }
    const turnstile = await checkTurnstile(req, body)
    if (turnstile) return res.status(turnstile.status).json(turnstile.data)

    const withdrawalCode = randomBytes(24).toString('base64url')
    try {
      db.prepare(`
        INSERT INTO signatures
        (first_name, last_name, email, role, message, is_public, consent_version, created_at, withdrawal_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(firstName, lastName, email, role, message, body.isPublic === true ? 1 : 0,
        CONSENT_VERSION, new Date().toISOString(), hash(withdrawalCode))
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: signatures.email')) {
        return res.status(409).json({
          error: 'Une signature a déjà été enregistrée avec cette adresse e-mail. Merci pour votre soutien !',
          fields: { email: 'Cette adresse e-mail a déjà signé la pétition.' },
        })
      }
      // Ne jamais journaliser le corps du formulaire ou les coordonnées des signataires.
      console.error('Impossible d’enregistrer une signature :', error.code ?? 'database_error')
      return res.status(503).json({ error: 'La signature n’a pas pu être enregistrée. Merci de réessayer dans quelques instants.' })
    }
    res.status(201).json({ count: countSignatures(), goal: milestone, firstName, withdrawalCode })
  })

  app.post('/api/signatures/withdraw', writeLimiter, (req, res) => {
    if (forbiddenOrigin(req)) {
      return res.status(403).json({ error: 'Merci de faire cette demande depuis le site de la pétition.' })
    }
    const code = cleanText(req.body?.withdrawalCode)
    if (!/^[\w-]{32}$/.test(code)) {
      return res.status(422).json({ error: 'Indiquez la référence de 32 caractères reçue après votre signature.' })
    }
    const result = db.prepare('DELETE FROM signatures WHERE withdrawal_hash = ?').run(hash(code))
    if (!result.changes) return res.status(404).json({ error: 'Cette référence est introuvable ou la signature a déjà été retirée.' })
    res.json({ count: countSignatures(), goal: milestone, withdrawn: true })
  })

  app.get('/api/admin/signatures.csv', (req, res) => {
    if (adminToken.length < 32) return res.status(503).json({ error: 'L’export privé n’est pas configuré.' })
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    const a = Buffer.from(hash(supplied))
    const b = Buffer.from(hash(adminToken))
    if (!timingSafeEqual(a, b)) return res.status(401).json({ error: 'Accès non autorisé.' })

    const rows = db.prepare(`SELECT first_name, last_name, email, role, message,
      is_public, consent_version, created_at FROM signatures ORDER BY id ASC`).all()
    const headers = ['Prénom', 'Nom', 'E-mail', 'Profil', 'Message privé', 'Affichage public autorisé', 'Version du consentement', 'Date UTC']
    const csv = '\uFEFF' + [headers, ...rows.map((row) => Object.values(row))]
      .map((row) => row.map(csvCell).join(';')).join('\r\n')
    res.type('text/csv').attachment('signatures-leborgne-en-action.csv').send(csv)
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Cette route n’existe pas.' }))
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error)
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Le formulaire est trop volumineux.' })
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({ error: 'Le formulaire reçu est invalide.' })
    }
    console.error('Erreur serveur :', error.code ?? 'internal_error')
    res.status(500).json({ error: 'Une erreur est survenue. Merci de réessayer.' })
  })
  return { app, db }
}
