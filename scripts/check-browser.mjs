import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import express from 'express'
import { chromium as playwright } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createApp } from '../server/app.mjs'

// Un serveur de production et une base isolée : aucun test ne pollue la pétition.
const { app, db } = createApp({ databasePath: ':memory:', rateLimits: false, production: true })
app.use(express.static(resolve('dist')))
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')))
const server = createServer(app)
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}`
let browser
let checks = 0
const passed = (label) => { checks++; console.log(`✓ ${label}`) }

try {
  let launchOptions = { headless: true }
  if (process.env.CHROMIUM_PATH) {
    launchOptions = { ...launchOptions, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
  } else {
    // Le paquet inclut le navigateur et ses bibliothèques, sans téléchargement externe.
    process.env.AWS_EXECUTION_ENV ??= 'AWS_Lambda_nodejs22.x'
    const { default: chromium } = await import('@sparticuz/chromium')
    launchOptions = {
      ...launchOptions,
      executablePath: await chromium.executablePath(),
      args: chromium.args.filter((arg) => arg !== '--disable-web-security'),
      env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`, FONTCONFIG_PATH: '/tmp/fonts' },
    }
  }
  browser = await playwright.launch(launchOptions)
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(15_000)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  assert.match(await page.title(), /Étudier\. Dignement\./)
  assert.match(await page.locator('h1').innerText(), /ÉTUDIER\.\nDIGNEMENT\./)
  assert.equal(await page.locator('.priority-card').count(), 7)
  passed('La page, les sept priorités et les polices locales se chargent en production')

  const scan = async (label) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    assert.deepEqual(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), [], label)
    passed(label)
  }
  await scan('Aucune violation détectée par axe sur la page desktop (WCAG A/AA)')

  const pdf = await fetch(url + '/documents/revendications-leborgne-en-action.pdf')
  assert.equal(pdf.status, 200)
  assert.match(pdf.headers.get('content-type'), /application\/pdf/)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.dossier-card').click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'Revendications-Leborgne-en-Action-2026-2027.pdf')
  passed('Le vrai dossier PDF s’ouvre et se télécharge')

  await page.getByRole('button', { name: 'Découvrir la demande : Des salles respirables', exact: true }).click()
  await page.locator('dialog').waitFor({ state: 'visible' })
  assert.match(await page.locator('dialog').innerText(), /deux fontaines/)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('dialog').evaluate((dialog) => dialog.contains(document.activeElement)), true)
  }
  await scan('La modale de revendication est accessible et garde le focus')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('dialog').count(), 0)
  passed('La touche Échap ferme la modale')

  await page.getByRole('button', { name: 'Je signe la pétition', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('#signature-firstName').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.locator('#signature-consent').getAttribute('aria-invalid'), 'true')
  passed('Les champs obligatoires et le consentement sont vérifiés')

  await page.locator('#signature-firstName').fill('Camille')
  await page.locator('#signature-lastName').fill('Laurent')
  await page.locator('#signature-email').fill('camille@example.test')
  await page.locator('#signature-role').selectOption('eleve')
  await page.getByRole('button', { name: /Ajouter un message de soutien/ }).click()
  await page.locator('#signature-message').fill('Ensemble pour notre lycée.')
  await page.getByRole('button', { name: 'Confidentialité', exact: true }).first().click()
  await scan('La notice de confidentialité est accessible')
  await page.keyboard.press('Escape')
  await page.locator('#signature-consent').check()
  await page.locator('#signature-isPublic').check()
  await page.getByRole('button', { name: 'Je signe la pétition', exact: true }).click()
  await page.getByRole('heading', { name: /Merci, Camille/ }).waitFor()
  const code = (await page.locator('.receipt-code code').innerText()).trim()
  assert.match(code, /^[\w-]{32}$/)
  await page.getByRole('heading', { name: 'Camille L.', exact: true }).waitFor()
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 1)
  assert.equal(await page.locator('.progress-top strong').innerText(), '1')
  passed('La signature est réellement enregistrée, le compteur et les soutiens sont actualisés')
  await scan('La confirmation de signature et le soutien public sont accessibles')

  await page.getByRole('button', { name: 'Parents', exact: true }).click()
  await page.getByRole('heading', { name: /Pas encore de soutien public dans cette catégorie/ }).waitFor()
  await page.getByRole('button', { name: 'Lycéens', exact: true }).click()
  await page.getByRole('heading', { name: 'Camille L.', exact: true }).waitFor()
  passed('Les filtres des soutiens fonctionnent')

  await page.goto(url + '/#signer', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#signature-firstName').fill('Camille')
  await page.locator('#signature-lastName').fill('Laurent')
  await page.locator('#signature-email').fill('CAMILLE@example.test')
  await page.locator('#signature-consent').check()
  await page.getByRole('button', { name: 'Je signe la pétition', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /déjà été enregistrée/)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 1)
  passed('Le navigateur affiche le rejet des doublons sans incrémenter le compteur')

  await page.getByRole('button', { name: 'Retirer ma signature', exact: true }).click()
  await page.locator('#withdrawal-code').fill(code)
  await page.getByRole('button', { name: 'Retirer définitivement ma signature', exact: true }).click()
  await page.getByRole('heading', { name: 'Votre signature a été retirée.', exact: true }).waitFor()
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM signatures').get().count, 0)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.progress-top strong').innerText(), '0')
  passed('Le retrait supprime les données et remet le compteur à zéro')

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url })
  await page.getByRole('button', { name: 'Faire passer le mot', exact: true }).click()
  await page.locator('.toast').waitFor()
  assert.match(await page.locator('.toast').innerText(), /copié/)
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url + '/')
  passed('Le bouton de partage copie le lien de la pétition')

  await mkdir('test-results', { recursive: true })
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    await page.goto(url, { waitUntil: 'networkidle' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Débordement à ${width}px`)
    if ([1440, 390].includes(width)) {
      await page.screenshot({ path: `test-results/site-${width}.png`, fullPage: true })
    }
    passed(`Mise en page sans défilement horizontal à ${width}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('.mobile-sign-bar').isVisible(), true)
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click()
  await page.locator('#mobile-navigation').getByRole('link', { name: 'Nos revendications', exact: true }).click()
  assert.equal(await page.locator('#mobile-navigation').isVisible(), false)
  assert.equal(new URL(page.url()).hash, '#revendications')
  passed('Le menu mobile et la barre de signature fixe fonctionnent')
  await scan('Aucune violation détectée par axe sur téléphone (WCAG A/AA)')
  assert.deepEqual(errors, [])
  passed('Aucune erreur JavaScript ni violation de la politique de sécurité en production')
  console.log(`\n${checks} vérifications navigateur réussies. Base de test isolée, aucune signature fictive ajoutée au site.`)
} finally {
  if (browser) await browser.close()
  await new Promise((done) => server.close(done))
  db.close()
}
