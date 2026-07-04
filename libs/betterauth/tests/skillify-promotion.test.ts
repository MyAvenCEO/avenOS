import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { crud, runCodeActor, runNamedOp } from '../src/actor-run'
import { db } from '../src/db'
import { composeFlows } from '../src/flows'
import { saveMockup } from '../src/mockup-caps'
import { promotionProgress,
	deriveAppSkeleton,
	mintDataLayer,
	promoteVibe,
	seedData,
	smokeRunOverview,
	wireSkill
} from '../src/promote-caps'
import { loadVibe } from '../src/vibe-registry'

// board 0113 — PROMOTION: a mockup becomes a full interactive skill. The GLM seams (vocabulary + sandbox
// code) are STUBBED with fixed plans; everything else runs FOR REAL: ontology save → bundle → derived
// ops → skill/actor rows → the QuickJS sandbox (actor.code's FIRST real occupant) → seeds → vibe copy →
// crud-add reflected by the code actor. Stateless steps, keyed by the mockup name.

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
const DB = await hasDb()
const d = DB ? describe : describe.skip
const UID = 'CkoZlEwLP8nOeBV5UYTmmfdrzyBd4zpt' // needs the seeded base vocab (owned_by etc.)

const APP = 'zzz-fin'
const SOURCE = {
	totalBalance: '15,50 €',
	records: [
		{ name: 'Edeka', amount: '10,50 €', category: 'Lebensmittel', date: 'Heute' },
		{ name: 'Bäcker', amount: '5,00 €', category: 'Lebensmittel', date: 'Gestern' }
	]
}
const VIEW = {
	content: {
		class: 'zf-root',
		children: [
			{ text: '$totalBalance', class: 'zf-total' },
			{
				class: 'zf-list',
				children: [
					{ $each: { items: '$records', template: { class: 'zf-row', children: [{ text: '$$name', class: 'zf-n' }, { text: '$$amount', class: 'zf-a' }] } } }
				]
			}
		]
	}
}
const STYLE = { tokens: {}, selectors: { '.zf-root': { display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' } } }

// the fixed vocabulary plan (the GLM seam): one entity predicate + three field predicates, plus a reuse.
const mkDef = (predicate: string, role: string) => ({
	predicate,
	gismu: null,
	gloss: `${predicate}: x1 the ${role} entity ref, x2 the value`,
	places: [
		{ pos: 'x1', role, gloss: 'the entity row', kind: 'ref' as const },
		{ pos: 'x2', role: `${role} value`, gloss: 'the carried value', kind: 'value' as const }
	]
})
const VOCAB = {
	entity: { def: mkDef('zzz_record', 'record') },
	fields: {
		amount: { def: mkDef('zzz_amount', 'amount') },
		category: { def: mkDef('zzz_category', 'category') },
		date: { def: mkDef('zzz_when', 'when') }
	}
}
// the fixed sandbox code (the GLM seam): list via caps.ops, sum amounts, return the CONTRACT shape.
const CODE = `async function handle(msg, caps) {
	const r = await caps.ops('record.list', {})
	const rows = (r && r.rows) || []
	let total = 0
	for (const x of rows) {
		const v = parseFloat(String(x.amount || '0').replace(/[^0-9,.-]/g, '').replace(',', '.'))
		if (!isNaN(v)) total += v
	}
	return { totalBalance: total.toFixed(2).replace('.', ',') + ' €', records: rows }
}`

d('board 0113 — mockup → full skill promotion (GLM seams stubbed, everything else real)', () => {
	test('(a) deriveAppSkeleton: arrays → entities+fields, scalars → computed aggregates', () => {
		const sk = deriveAppSkeleton(APP, SOURCE)
		expect(sk.entities).toEqual([
			{ key: 'records', type: 'record', fields: ['name', 'amount', 'category', 'date'] }
		])
		expect(sk.aggregates).toEqual(['totalBalance'])
	})

	test('(b) skillify carries the 5 step actors + the EXPLICIT pipeline flow (edges)', async () => {
		const flow = (await composeFlows()).find((f) => f.id === 'skillify')
		const nodeIds = (flow?.nodes as { id: string }[]).map((n) => n.id)
		for (const step of ['plan_app', 'mint_data', 'wire_actors', 'seed_data', 'promote'])
			expect(nodeIds).toContain(step)
		const edges = flow?.edges as { from: string; to: string }[]
		expect(edges.some((e) => e.from === 'plan_app' && e.to === 'mint_data')).toBe(true)
		expect(edges.some((e) => e.from === 'seed_data' && e.to === 'promote')).toBe(true)
	})

	test('(c) the full pipeline lands: bundle+ops · skill+sandbox actor · smoke · seed · vibe copy', async () => {
		// the mockup fixture (part 1 machinery).
		await saveMockup(APP, { view: VIEW, style: STYLE, source: SOURCE })
		const sk = deriveAppSkeleton(APP, SOURCE)

		// PROGRESS (the pipeline's derived memory): nothing built yet → plan / mint_data next.
		const p0 = await promotionProgress(UID, sk)
		expect(p0.step).toBe('plan')
		expect(p0.next).toBe('mint_data')

		// S2 — mint the data layer through the Ontology save cap (vocab seam fixed).
		const minted = await mintDataLayer(UID, sk, SOURCE, async () => VOCAB)
		expect(minted.error).toBeUndefined()
		expect(minted.types?.[0]?.type).toBe('record')
		const ops = await sql<{ name: string }>`
			SELECT name FROM data_operations WHERE name LIKE 'record.%' ORDER BY name
		`.execute(db())
		expect(ops.rows.map((r) => r.name)).toEqual([
			'record.create',
			'record.delete',
			'record.list',
			'record.update'
		])

		const p1 = await promotionProgress(UID, sk)
		expect(p1.step).toBe('data')
		expect(p1.next).toBe('wire_actors')

		// S3 — the smoke gate + the wired skill (code seam fixed).
		const smoke = await smokeRunOverview(CODE, sk, SOURCE)
		expect(smoke.ok).toBe(true)
		expect(smoke.state?.totalBalance).toBe('15,50 €') // computed from the stub rows
		const wired = await wireSkill(UID, sk, SOURCE, CODE)
		expect(wired.error).toBeUndefined()
		expect(wired.skillId).toBe(APP)
		const actors = await sql<{ name: string; code: string | null; caps: unknown }>`
			SELECT name, code, caps FROM actor WHERE skill_id = ${APP} ORDER BY position
		`.execute(db())
		expect(actors.rows.map((a) => a.name)).toEqual(['data_crud', `${APP}_overview`])
		expect((actors.rows[1].code ?? '').length).toBeGreaterThan(50) // the sandbox seat, occupied
		expect(JSON.stringify(actors.rows[1].caps)).toContain('ops') // fail-closed caps

		const p2 = await promotionProgress(UID, sk)
		expect(p2.step).toBe('wired')
		expect(p2.next).toBe('seed_data')

		// S4 — seed + promote (the identity mapper survives: rows copied, mock stays).
		const seeded = await seedData(UID, sk, SOURCE)
		expect(seeded.seeded.records).toBe(2)
		await promoteVibe(APP)
		const real = await loadVibe(APP)
		expect(real?.view).toBeTruthy()
		expect(real?.logic).toContain('initState') // the identity mapper, unchanged
		const mock = await loadVibe(`mock-${APP}`)
		expect(mock?.view).toBeTruthy() // the mock remains
		const p3 = await promotionProgress(UID, sk)
		expect(p3.step).toBe('live')
		expect(p3.next).toBeNull()
	}, 30000)

	test('(d) FULLY INTERACTIVE: a crud-added record shows up in the sandbox actor\'s next run', async () => {
		await crud(UID, {
			schema: 'record',
			action: 'create',
			items: [{ name: 'Rewe', amount: '12,50 €', category: 'Lebensmittel', date: 'Heute' }]
		})
		// run the REAL actor row (real ops caps — the 0111 runtime path the chat loop uses).
		const row = await sql<{ name: string; code: string | null; caps: unknown; prompt: string | null; engine: string | null }>`
			SELECT name, code, caps, prompt, engine FROM actor WHERE skill_id = ${APP} AND name = ${`${APP}_overview`}
		`.execute(db())
		const actor = {
			name: row.rows[0].name,
			code: row.rows[0].code,
			caps: (typeof row.rows[0].caps === 'string' ? JSON.parse(row.rows[0].caps as string) : row.rows[0].caps) as string[],
			prompt: row.rows[0].prompt,
			engine: row.rows[0].engine
		}
		const run = await runCodeActor(actor, {}, UID)
		expect(run.ran).toBe(true)
		const state = run.result as { totalBalance: string; records: unknown[] }
		expect(state.records.length).toBe(3) // 2 seeded + 1 added in chat-style
		expect(state.totalBalance).toBe('28,00 €') // 10,50 + 5,00 + 12,50
	}, 30000)

	afterAll(async () => {
		if (!DB) return
		const D = db()
		// tear the promoted app back down (skill, actors, flow-free), the data layer, and the vibes.
		await sql`DELETE FROM actor WHERE skill_id = ${APP}`.execute(D)
		await sql`DELETE FROM skill WHERE id = ${APP}`.execute(D)
		await sql`DELETE FROM data_operations WHERE name LIKE 'record.%'`.execute(D)
		await sql`DELETE FROM data_bundles WHERE type = 'record'`.execute(D)
		const rows = await sql<{ id: string }>`
			SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = 'zzz_record'
		`.execute(D)
		for (const r of rows.rows)
			await sql`DELETE FROM data_value WHERE user_id = ${UID} AND (id = ${r.id} OR x1 = ${r.id} OR x2 = ${r.id})`.execute(D)
		await sql`DELETE FROM data_schema WHERE user_id = ${UID} AND name LIKE 'zzz_%'`.execute(D)
		for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
			await sql`DELETE FROM ${sql.raw(t)} WHERE name IN (${APP}, ${`mock-${APP}`})`.execute(D)
	})
})
