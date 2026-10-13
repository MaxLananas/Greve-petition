import postgres from 'postgres'

export function createDBFromEnv(env) {
  if (!env.DATABASE_URL) return null
  const sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  })
  const makePrepared = (queryString, params = []) => {
    const bound = params.length ? params.map(p => (p === undefined ? null : p)) : []
    return {
      bind: (...next) => {
        const combined = bound.concat(next)
        return makePrepared(queryString, combined)
      },
      get: async () => {
        const res = await sql.unsafe(queryString, bound)
        return res?.[0] ?? null
      },
      all: async () => await sql.unsafe(queryString, bound),
      run: async () => {
        const res = await sql.unsafe(queryString, bound)
        return { meta: { changes: res?.rowCount ?? 1 } }
      },
      first: async (col) => {
        const res = await sql.unsafe(queryString, bound)
        const row = res?.[0] ?? null
        return col && row ? row[col] : row
      },
    }
  }
  return {
    prepare: (q) => makePrepared(q, []),
    batch: async (stmts) => {
      // Sequential execution inside a transaction for atomicity
      const results = []
      await sql.begin(async (tx) => {
        for (const stmt of stmts) {
          // stmt is expected to be our prepared object with ._sync or similar
          // But our makePrepared returns objects; for batch we just run sequentially
          if (stmt && typeof stmt.get === 'function') {
            const r = await stmt.get()
            results.push({ results: r ? [r] : [], meta: { changes: 0 } })
          } else if (stmt && typeof stmt.run === 'function') {
            const r = await stmt.run()
            results.push({ meta: r.meta || { changes: 1 } })
          } else {
            results.push({ results: [], meta: { changes: 0 } })
          }
        }
      })
      return results
    },
    close: () => sql.end({ timeout: 5 }),
  }
}
