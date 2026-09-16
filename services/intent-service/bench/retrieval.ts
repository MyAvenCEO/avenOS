/** Disposable real-PostgreSQL scale proof; no customer data. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import pg from 'pg'
import { IntentStore } from '../src/store'

const url = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
if (!url) throw Error('Set INTENT_RETRIEVAL_TEST_DATABASE_URL to a disposable PostgreSQL server.')
const admin = new pg.Pool({ connectionString: url }),
	name = `scale_${randomUUID().replaceAll('-', '')}`
await admin.query(`CREATE DATABASE ${name}`)
const target = new URL(url)
target.pathname = `/${name}`
const pool = new pg.Pool({
		connectionString: target.toString(),
		options: '-c search_path=aven_intents,public'
	}),
	owner = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const store = new IntentStore(pool)
const evidence: Array<Record<string, unknown>> = []
try {
	await pool.query('CREATE SCHEMA aven_intents')
	for (const file of ['0001_intents.sql'])
		await pool.query(
			await readFile(
				new URL(`../../platform-provisioner/components/intents/${file}`, import.meta.url),
				'utf8'
			)
		)
	let previous = 0
	for (const count of [10000, 100000, 1000000]) {
		const started = performance.now()
		await pool.query(
			`INSERT INTO intents(id,owner_subject_id,trigger_kind,title,routing_summary)
   SELECT md5('intent-'||n)::uuid,$1,'human','Routine task '||n,'Supplier invoices travel and family'
   FROM generate_series($2::int,$3::int) n ON CONFLICT DO NOTHING`,
			[owner, Math.floor(previous / 100) + 1, Math.ceil(count / 100)]
		)
		await pool.query(
			`INSERT INTO contributions(id,intent_id,sequence,contributor_kind,kind,text,idempotency_key)
   SELECT md5('message-'||n)::uuid,md5('intent-'||(1+(n-1)/100))::uuid,1+(n-1)%100,'human','message',
    'Invoice travel refund booking common evidence '||n||' '||CASE WHEN n%997=0 THEN 'rarebeacon ' ELSE '' END||repeat('Synthetic ordinary conversation about an ongoing task. ',8), 'seed-'||n
   FROM generate_series($1::int,$2::int) n`,
			[previous + 1, count]
		)
		await pool.query('ANALYZE intents')
		await pool.query('ANALYZE contributions')
		const buildMs = performance.now() - started,
			measurements: Record<string, number[]> = {}
		for (let round = 0; round < 20; round++)
			for (const [kind, run] of Object.entries({
				recent: () => store.page(owner, { limit: 20 }),
				common: () => store.messages(owner, { query: 'common evidence', limit: 20 }),
				rare: () => store.messages(owner, { query: 'rarebeacon', limit: 20 }),
				missing: () => store.messages(owner, { query: 'nonexistentbeacon', limit: 20 }),
				scoped: () =>
					store.messages(owner, {
						intent: createHash('md5')
							.update('intent-1')
							.digest('hex')
							.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
						query: 'common',
						limit: 20
					})
			})) {
				const t = performance.now(),
					result = await run(),
					elapsed = performance.now() - t
				if ('messages' in result && result.messages.length > 20) throw Error('Unbounded messages')
				if (
					['rare', 'common', 'scoped'].includes(kind) &&
					'messages' in result &&
					!result.messages.length
				)
					throw Error('Target was not found')
				measurements[kind] ??= []
				measurements[kind].push(elapsed)
			}
		const stats = Object.fromEntries(
			Object.entries(measurements).map(([key, ms]) => {
				ms.sort((a, b) => a - b)
				return [key, { medianMs: ms[10], p95Ms: ms[18], maxMs: ms[19] }]
			})
		)

		const plan = await pool.query(
			`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT c.id FROM contributions c JOIN intents i ON i.id=c.intent_id WHERE c.owner_subject_id=$1 AND i.owner_subject_id=$1 AND i.state NOT IN ('merged','deleted') AND c.contributor_kind IN ('human','agent') AND c.text IS NOT NULL AND c.search_vector @@ plainto_tsquery('simple','rarebeacon') ORDER BY c.id LIMIT 21`,
			[owner]
		)
		evidence.push({ count, buildMs, stats, unguardedBaselineRarePlan: plan.rows[0]['QUERY PLAN'] })
		console.log(JSON.stringify({ count, buildMs, stats }))
		await writeFile(
			process.env.INTENT_RETRIEVAL_EVIDENCE_PATH ?? '/tmp/intent-retrieval-scale.json',
			JSON.stringify({ engine: 'PostgreSQL 17', evidence }, null, 2)
		)
		previous = count
	}
	if (
		evidence.some((e) =>
			Object.values(e.stats as Record<string, { p95Ms: number }>).some((s) => s.p95Ms > 250)
		)
	)
		throw Error('Query p95 exceeded 250ms')
} finally {
	await pool.end()
	await admin.query(`DROP DATABASE ${name}`)
	await admin.end()
}
