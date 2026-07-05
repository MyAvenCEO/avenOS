import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { buildCaps, crud, runCodeActor, runNamedOp } from '../src/actor-run'
import { db } from '../src/db'
import { composeFlows } from '../src/flows'
import { saveMockup } from '../src/mockup-caps'
import { connectSkills, editSkillMeta, improveSkill, promotionProgress, smokeRunConnector, syncActors, typesOfSkill,
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
		// self-improvable by construction: the promoted skill advertises its own improve_skill.
		expect(actors.rows.map((a) => a.name)).toEqual(['data_crud', `${APP}_overview`, 'improve_skill'])
		// Planner-grade PRESENCE from birth: granular flow nodes + per-verb cards (board 0116 slice).
		const fl = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = ${APP}`.execute(db())
		const nodeIds = ((typeof fl.rows[0].nodes === 'string' ? JSON.parse(fl.rows[0].nodes as string) : fl.rows[0].nodes) as { id: string }[]).map((n) => n.id)
		for (const id of ['dispatch', 'overview', 'read', 'create', 'edit', 'delete', 'improve']) expect(nodeIds).toContain(id)
		for (const v of ['record-created', 'record-edited']) {
			const vr = await sql`SELECT 1 FROM vibe_view WHERE name = ${v}`.execute(db())
			expect(vr.rows.length).toBe(1)
		}
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
		// DESIGN DRIFT re-opens promote (Samuel: "edit then promote to production must work"):
		// touch the mock's style → progress says promote again; re-promote → drift cleared.
		await sql`UPDATE vibe_style SET body = jsonb_set(body, '{tokens,zz}', '"1"') WHERE name = ${`mock-${APP}`}`.execute(db())
		const pd = await promotionProgress(UID, sk)
		expect(pd.step).toBe('live')
		expect(pd.drift).toContain('style')
		expect(pd.next).toBe('promote')
		await promoteVibe(APP)
		const pc = await promotionProgress(UID, sk)
		expect(pc.next).toBeNull()
		// metadata editing: label/description change, the id NEVER does (wire-stable).
		const meta = await editSkillMeta(APP, { label: 'Zzz Finanzen', description: 'test description' })
		expect(meta.error).toBeUndefined()
		const skRow = await sql<{ id: string; label: string; description: string }>`
			SELECT id, label, description FROM skill WHERE id = ${APP}
		`.execute(db())
		expect(skRow.rows[0].label).toBe('Zzz Finanzen')
		expect(skRow.rows[0].description).toBe('test description')
		expect((await editSkillMeta('no-such-skill', { label: 'x' })).error).toContain('no skill')
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

	test('(e) improve_skill: a user rule lands in the data_crud mailbox — wording only, fail-closed', async () => {
		// the GLM seam is fixed; the graft path (bounds + schema-shape protection) runs for real.
		const RULE = 'amounts use German format (25,33 €); bought/purchase means NEGATIVE.'
		const res = await improveSkill(APP, RULE, async (mb) => ({
			description: `${String(mb.description ?? '')} RULES: ${RULE}`,
			properties: { items: 'Rows to write. Amounts German-formatted; purchases negative.', bogus: 'never lands' }
		}))
		expect(res.error).toBeUndefined()
		expect(res.app).toBe(APP)
		const row = await sql<{ mailbox: unknown }>`
			SELECT mailbox FROM actor WHERE skill_id = ${APP} AND name = 'data_crud'
		`.execute(db())
		const mb = (typeof row.rows[0].mailbox === 'string' ? JSON.parse(row.rows[0].mailbox as string) : row.rows[0].mailbox) as {
			description: string
			parameters: { properties: Record<string, { description?: string }>; required: string[] }
		}
		expect(mb.description).toContain('NEGATIVE')
		expect(mb.parameters.properties.items.description).toContain('German')
		expect('bogus' in mb.parameters.properties).toBe(false) // shape is never GLM-writable
		expect(mb.parameters.required).toEqual(['schema', 'action']) // untouched
		// honest failures: unknown skill · out-of-bounds description.
		const miss = await improveSkill('no-such-app', RULE, async () => ({ description: 'x'.repeat(50) }))
		expect(miss.error).toContain('not promoted')
		const junk = await improveSkill(APP, RULE, async () => ({ description: 'tiny' }))
		expect(junk.error).toContain('out of bounds')
	}, 20000)

	test('(f) sync_actors is ADD-ONLY + idempotent: re-adds only what is missing', async () => {
		// full presence exists → empty diff, honestly.
		const noop = await syncActors(APP)
		expect(noop.error).toBeUndefined()
		expect(noop.addedNodes).toEqual([])
		expect(noop.addedVibes).toEqual([])
		// simulate a pre-granularity skill: drop one card + one flow node, sync restores JUST those.
		for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
			await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'record-created'`.execute(db())
		const fl = await sql<{ nodes: unknown; edges: unknown }>`SELECT nodes, edges FROM flow WHERE id = ${APP}`.execute(db())
		const nodes = (typeof fl.rows[0].nodes === 'string' ? JSON.parse(fl.rows[0].nodes as string) : fl.rows[0].nodes) as { id: string }[]
		await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes.filter((n) => n.id !== 'create'))}::jsonb WHERE id = ${APP}`.execute(db())
		const res = await syncActors(APP)
		expect(res.addedVibes).toEqual(['record-created'])
		expect(res.addedNodes).toEqual(['create'])
		// unknown skill fails honestly.
		expect((await syncActors('never-promoted-app')).error).toContain('not promoted')
	}, 20000)

	test('(g) board 0117 — scoped ops caps: granted schema passes, anything else throws', async () => {
		const caps = buildCaps(UID, ['ops:record'])
		const res = (await caps.ops?.('record.list', {})) as { rows?: unknown[] }
		expect(Array.isArray(res?.rows)).toBe(true)
		expect(() => caps.ops?.('todos.list', {})).toThrow('not granted')
		// bare 'ops' stays the legacy full grant.
		const full = buildCaps(UID, ['ops'])
		const ok = (await full.ops?.('todos.list', {})) as { rows?: unknown[] }
		expect(Array.isArray(ok?.rows)).toBe(true)
	}, 20000)

	test('(h) board 0117 — connectSkills: scoped connector actor + the composite flowRef node', async () => {
		// deterministic schema derivation from the skills' own config.
		expect(await typesOfSkill(APP)).toEqual(['record'])
		expect(await typesOfSkill('todos')).toEqual(['todos'])
		// the smoke gate REFUSES code that misses the contract or escapes its scopes.
		const bad = await smokeRunConnector('function handle(m,c){ return { nope: 1 } }', [])
		expect(bad.ok).toBe(false)
		// the STATIC sync-style gate (the sandbox supports caps calls only during the main eval).
		const asyncStyle = await smokeRunConnector(
			"async function handle(m,c){ var r = await c.ops('record.list',{}); return { summary: 'x' } }",
			[{ type: 'record', ops: [], sample: [] }]
		)
		expect(asyncStyle.ok).toBe(false)
		expect(asyncStyle.error).toContain('SYNCHRONOUS')
		// the LIVE "0 erstellt" bug shapes, now structurally rejected:
		const neverReads = await smokeRunConnector(
			"function handle(m,c){ return { summary: 'nichts gelesen' } }",
			[{ type: 'record', ops: [], sample: [{ name: 'x', amount: '1' }] }]
		)
		expect(neverReads.ok).toBe(false)
		expect(String(neverReads.error)).toMatch(/never read|changed NOTHING/)
		const batchItems = await smokeRunConnector(
			"function handle(m,c){ var r = c.ops('record.list',{}); c.ops('record.create', { items: r.rows }); return { summary: 'x' } }",
			[{ type: 'record', ops: [], sample: [{ name: 'x', amount: '1' }] }]
		)
		expect(batchItems.ok).toBe(false)
		expect(batchItems.error).toContain('ONE row object')
		const escape = await smokeRunConnector(
			"function handle(m,c){ c.ops('goal.list',{}); return { summary: 'x' } }",
			[{ type: 'record', ops: [], sample: [] }]
		)
		expect(escape.ok).toBe(false)
		expect(escape.error).toContain('not granted')
		// the seam-fixed connector wires end-to-end: actor row (scoped caps) + composite node.
		// PLAIN SYNC style — several blocking caps calls in one run (the fixed sandbox contract).
		// satisfies the SEMANTIC tripwire: a source-side change touches the target (one todo row).
		const CODE =
			"function handle(msg, caps){ var r = caps.ops('record.list', {}); var n = (r && r.rows ? r.rows.length : 0); var trig = msg && msg.trigger ? msg.trigger.schema : null; if (trig === 'record' || !trig) { caps.ops('todos.create', { title: 'Sync-Eintrag (Test 0117)' }) } return { summary: n + ' Einträge geprüft.' } }"
		const res = await connectSkills(UID, APP, 'todos', 'Ausgaben werden als Aufgaben nachgehalten', CODE)
		expect(res.error).toBeUndefined()
		expect(res.tool).toBe('sync_todos')
		const row = await sql<{ code: string | null; caps: unknown }>`
			SELECT code, caps FROM actor WHERE skill_id = ${APP} AND name = 'sync_todos'
		`.execute(db())
		expect(row.rows.length).toBe(1)
		const caps = (typeof row.rows[0].caps === 'string' ? JSON.parse(row.rows[0].caps as string) : row.rows[0].caps) as string[]
		expect(caps.sort()).toEqual(['ops:record', 'ops:todos'])
		// the LIVE run path (runCodeActor with the row's scoped caps) works read-only.
		const run = await runCodeActor(
			{ name: 'sync_todos', code: row.rows[0].code, caps, prompt: null, engine: null },
			{},
			UID
		)
		expect(run.ran).toBe(true)
		expect(String((run as { result: { summary: string } }).result.summary)).toContain('geprüft')
		// the source flow carries the connector leaf + the SUB-SKILL composite (flowRef → todos).
		const fl = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = ${APP}`.execute(db())
		const nodes = (typeof fl.rows[0].nodes === 'string' ? JSON.parse(fl.rows[0].nodes as string) : fl.rows[0].nodes) as Record<string, unknown>[]
		expect(nodes.some((n) => n.id === 'sync_todos' && n.actor === 'sync_todos')).toBe(true)
		const sub = nodes.find((n) => n.id === 'sub-todos')
		expect(sub?.flowRef).toBe('todos') // the composite/leaf recursion seat, occupied
		// advertised on BOTH endpoints: the router may land on either skill ("sync inventory" names
		// the TARGET) — the mirror row carries the same code + scoped caps.
		const mirror = await sql<{ caps: unknown }>`
			SELECT caps FROM actor WHERE skill_id = 'todos' AND name = 'sync_todos'
		`.execute(db())
		expect(mirror.rows.length).toBe(1)
		// board 0117 v2 — REACTIVE: a WRITE to the source schema FIRES the connector at the crud seam
		// (the actor row + its scoped caps ARE the trigger registration); its summary rides the result.
		const written = (await crud(UID, {
			schema: 'record',
			action: 'create',
			items: [{ name: 'Trigger-Test', amount: '1,00 €', category: 'Test', date: 'Heute' }]
		})) as { triggered?: { tool: string; summary: string }[] }
		expect(written.triggered?.some((t) => t.tool === 'sync_todos' && t.summary.includes('geprüft'))).toBe(true)
		// honest failures: unknown target · same skill twice.
		expect((await connectSkills(UID, APP, 'no-such-skill', 'x', CODE)).error).toContain('no skill')
		expect((await connectSkills(UID, APP, APP, 'x', CODE)).error).toContain('different')
	}, 30000)

	afterAll(async () => {
		if (!DB) return
		const D = db()
		await sql`DELETE FROM flow WHERE id = ${APP}`.execute(D)
		await sql`DELETE FROM actor WHERE skill_id = 'todos' AND name = 'sync_todos'`.execute(D)
		// the connector test-code creates real todos rows on its live runs — tear them down by title.
		try {
			const live = (await runNamedOp(UID, 'todos.list', {})) as { rows?: { id: string; title?: string }[] }
			for (const row of live.rows ?? [])
				if (String(row.title ?? '').includes('Sync-Eintrag (Test 0117)'))
					await runNamedOp(UID, 'todos.delete', { id: row.id })
		} catch {
			/* best-effort cleanup */
		}
		for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
			await sql`DELETE FROM ${sql.raw(t)} WHERE name IN ('record-created', 'record-edited')`.execute(D)
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
	}, 30000)
})
