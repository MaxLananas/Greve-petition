import postgres from 'postgres'

export function createDBFromEnv(env) {
  if (!env.DATABASE_URL) return null
  const sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  })
  function makePrepared(queryString, params = []) {
    return {
      bind(...values) { return makePrepared(queryString, params.concat(values)) },
      get: async () => { const [row] = await sql.unsafe(queryString, params); return row ?? null },
      all: async () => await sql.unsafe(queryString, params),
      run: async () => { const res = await sql.unsafe(queryString, params); return { meta: { changes: res?.rowCount ?? 1 } } },
      first: async (col) => { const [row] = await sql.unsafe(queryString, params); return row ? (col ? row[col] : row) : null },
    }
  }
  return {
    prepare: (q) => makePrepared(q, []),
    batch: async (statements) => {
      const out = []
      for (const stmt of statements) {
        if (stmt && typeof stmt.get === 'function') {
          const row = await stmt.get()
          out.push({ results: row ? [row] : [], meta: { changes: 0 } })
        } else if (stmt && typeof stmt.run === 'function') {
          const r = await stmt.run()
          out.push({ meta: r.meta || { changes: 1 } })
        } else {
          out.push({ results: [], meta: { changes: 0 } })
        }
      }
      return out
    },
    close: () => sql.end({ timeout: 5 }),
  }
}
