import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Compilation locale uniquement : pas de déploiement, connexion ou abonnement.
const child = spawn(process.execPath, [
  resolve('node_modules/wrangler/bin/wrangler.js'), 'pages', 'functions', 'build',
  '--outdir', '.cache/pages-functions', '--compatibility-date', '2026-10-01',
], { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' } })
child.on('error', () => { console.error('Impossible de démarrer Wrangler. Lancez npm ci.'); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
