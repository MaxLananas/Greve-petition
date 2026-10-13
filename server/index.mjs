import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createApp } from './app.mjs'

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 3000)
const { app, db } = createApp({
  databasePath: process.env.DATABASE_PATH || './data/signatures.sqlite',
  goal: Number(process.env.SIGNATURE_GOAL || 1000),
  contactEmail: process.env.CONTACT_EMAIL || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  production,
  writeLimit: Number(process.env.SIGNATURE_RATE_LIMIT || 60),
})
const server = createServer(app)
let vite

function publicMetadata(html) {
  if (!process.env.PUBLIC_URL) return html
  try {
    const url = new URL(process.env.PUBLIC_URL)
    if (!['http:', 'https:'].includes(url.protocol)) return html
    const base = url.origin
    return html.replace('content="/assets/partage.png"', `content="${base}/assets/partage.png"`)
      .replace('</head>', `  <meta property="og:url" content="${base}" />\n    <link rel="canonical" href="${base}" />\n  </head>`)
  } catch {
    return html
  }
}

if (!production) {
  const { createServer: createViteServer } = await import('vite')
  vite = await createViteServer({
    server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true, hmr: { server } },
    appType: 'custom',
  })
  app.use(vite.middlewares)
  app.get('/{*path}', async (req, res, next) => {
    try {
      const template = publicMetadata(await readFile(resolve('index.html'), 'utf8'))
      const html = await vite.transformIndexHtml(req.originalUrl, template)
      res.status(200).type('html').send(html)
    } catch (error) {
      vite.ssrFixStacktrace(error)
      next(error)
    }
  })
} else {
  app.use(express.static(resolve('dist'), { index: false, maxAge: '1h' }))
  app.get('/{*path}', async (_req, res, next) => {
    try {
      const html = publicMetadata(await readFile(resolve('dist/index.html'), 'utf8'))
      res.type('html').send(html)
    } catch (error) {
      next(error)
    }
  })
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Leborgne en Action — http://0.0.0.0:${port} (${production ? 'production' : 'développement'})`)
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.close(async () => {
    if (vite) await vite.close()
    db.close()
    process.exit(0)
  })
  // Les connexions HMR ne doivent pas empêcher un arrêt propre.
  server.closeAllConnections()
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
