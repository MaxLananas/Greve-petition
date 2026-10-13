import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

export async function createCloudflareRuntime({ bindings = {}, initialize = true, persistDirectory } = {}) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('.cache/pages-functions/index.js'),
    compatibilityDate: '2026-10-01',
    d1Databases: ['DB'],
    d1Persist: persistDirectory ?? false,
    bindings,
  }))
  try {
    await runtime.ready
    const db = await runtime.getD1Database('DB')
    if (initialize) {
      // D1 exec() découpe par lignes ; utiliser batch() comme Wrangler.
      // Ce parseur concerne uniquement notre migration contrôlée et ses triggers.
      const sql = (await readFile(resolve('migrations/0001_signatures.sql'), 'utf8')).replace(/--[^\n]*/g, '')
      const triggers = []
      const regular = sql.replace(/CREATE\s+TRIGGER[\s\S]*?\bEND;/gi, (trigger) => { triggers.push(trigger); return '' })
      const statements = [...regular.split(';').map((part) => part.trim()).filter(Boolean), ...triggers]
      await db.batch(statements.map((query) => db.prepare(query)))
    }
    return { runtime, db, close: () => runtime.dispose(), fetch: (request) => runtime.dispatchFetch(request) }
  } catch (error) { await runtime.dispose(); throw error }
}
