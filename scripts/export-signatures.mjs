import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const base = process.env.PUBLIC_URL?.trim()
const token = process.env.ADMIN_TOKEN?.trim()
if (!base || !token || token.length < 32) {
  console.error('Renseignez PUBLIC_URL et ADMIN_TOKEN dans votre fichier .env privé. Ne publiez jamais le secret.')
  process.exit(1)
}
const origin = new URL(base)
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  console.error('L’export distant doit utiliser HTTPS pour protéger les coordonnées et le secret.')
  process.exit(1)
}
let after = 0
let total = 0
let output = '\uFEFF'
const seen = new Set()
while (true) {
  const url = new URL('/api/admin/signatures.csv', origin)
  if (after) url.searchParams.set('after', String(after))
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    console.error(data?.error ?? `Échec de l’export (HTTP ${response.status}).`)
    process.exit(1)
  }
  let csv = (await response.text()).replace(/^\uFEFF/, '')
  if (after) csv = csv.slice(csv.indexOf('\r\n') + 2)
  output += csv + '\r\n'
  total += Number(response.headers.get('X-Export-Count') ?? 0)
  if (response.headers.get('X-Export-Complete') !== 'false') break
  const next = Number(response.headers.get('X-Next-Cursor'))
  if (!Number.isSafeInteger(next) || next <= after || seen.has(next)) {
    console.error('Curseur de pagination invalide ; aucun fichier partiel n’a été enregistré.')
    process.exit(1)
  }
  seen.add(next)
  after = next
}
const destination = resolve(process.argv[2] ?? `data/signatures-${new Date().toISOString().slice(0, 10)}.csv`)
await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
await writeFile(destination, output, { mode: 0o600 })
console.log(`Export privé enregistré : ${destination}${total ? ` (${total} signatures)` : ''}`)
console.log('Ne partagez pas ce fichier publiquement et ne le mettez pas dans GitHub.')
