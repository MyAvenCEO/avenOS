import { db } from './src/db'
import { ontologyCaps } from './src/ontology'
import { sql } from 'kysely'
const u = await sql<{user_id:string}>`SELECT DISTINCT user_id FROM data_value LIMIT 1`.execute(db())
const caps = ontologyCaps(u.rows[0]!.user_id)
const existing = await caps.list()
const t0 = Date.now()
const m = await caps.mint('a person can rent an apartment and can teach a subject', existing)
console.log('took', ((Date.now()-t0)/1000).toFixed(0)+'s ·', m.results?.length ?? 0, 'results')
for (const r of m.results ?? []) console.log(r.reuse ? `  reuse ${r.reuse}` : `  mint ${r.def?.predicate} (${r.def?.gismu}) · ${r.def?.places.length} places`)
process.exit(0)
