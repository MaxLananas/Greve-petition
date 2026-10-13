import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

// Adaptateur de test seulement. La production utilise la véritable liaison D1.
export function createTestD1({ initialize = true, failQuery } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  const migration = readFileSync(new URL('../../migrations/0001_signatures.sql', import.meta.url), 'utf8')
  if (initialize) sqlite.exec(migration)

  function prepare(sql, parameters = []) {
    const sync = () => {
      failQuery?.(sql)
      const before = sqlite.prepare('SELECT total_changes() AS total').get().total
      const results = sqlite.prepare(sql).all(...parameters)
      const after = sqlite.prepare('SELECT total_changes() AS total').get().total
      return { success: true, results, meta: { changes: Number(after - before) } }
    }
    return {
      _sync: sync,
      bind: (...values) => prepare(sql, values),
      all: async () => sync(),
      run: async () => sync(),
      first: async (column) => { const row = sync().results[0] ?? null; return column && row ? row[column] : row },
    }
  }
  const db = {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement._sync())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { db, sqlite, migration, close: () => sqlite.close() }
}
