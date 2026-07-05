import { type Kysely, sql } from 'kysely'

// board 0113 — the PROMOTION pipeline as config: five step actor rows on skillify (plan_app → mint_data
// → wire_actors → seed_data → promote — each with its own reactable card), the skillify EXPLICIT flow
// row whose edges ARE the pipeline (the 2nd orchestration-as-config example after the Planner), and the
// `skill-plan` card (the plan/wired step vibe).

const IDS: Record<string, string> = {
	plan_app: '00000000-0000-0000-0000-0000000113b1',
	mint_data: '00000000-0000-0000-0000-0000000113b2',
	wire_actors: '00000000-0000-0000-0000-0000000113b3',
	seed_data: '00000000-0000-0000-0000-0000000113b4',
	promote: '00000000-0000-0000-0000-0000000113b5'
}

const NAME_PARAM = {
	name: { type: 'string', description: 'The mockup being promoted (kebab-case or plain words).' },
	response: { type: 'string', description: 'A short human-facing reply to show the user.' }
}
const STEPS: { name: string; description: string; vibe?: string; extra?: Record<string, unknown> }[] = [
	{
		name: 'plan_app',
		vibe: 'skill-plan',
		description:
			'STEP 1 of promoting a mockup to a real skill: derive + show the APP PLAN (entities from the ' +
			'example data, their fields, computed aggregates, seed counts). Use when the user says ' +
			'"skillify/promote the X mockup". The next step after the user agrees is mint_data.'
	},
	{
		name: 'mint_data',
		vibe: 'bundle-created',
		description:
			'STEP 2: mint the DATA layer for the app being promoted — Lojban predicates (reuse or mint via ' +
			'the Ontology engine) + the bundle + the derived CRUD ops. Run only after plan_app was agreed.'
	},
	{
		name: 'wire_actors',
		vibe: 'skill-plan',
		description:
			'STEP 3: create the new SKILL row + its actors — the generic data_crud and the SANDBOXED ' +
			'overview actor (GLM-authored code, smoke-run gated). Run only after mint_data succeeded.'
	},
	{
		name: 'seed_data',
		vibe: 'todos-created',
		description:
			"STEP 4 (skippable): write the mockup's example rows as REAL data through the derived create " +
			'op. Pass skip:true to skip when the user declines seeding.',
		extra: { skip: { type: 'boolean', description: 'Skip seeding (the user declined).' } }
	},
	{
		name: 'promote',
		description:
			'FINAL STEP: promote the vibe (mock-<name> → <name>) and show the finished app rendered with ' +
			'REAL data via its sandbox actor. Run only after wire_actors (and optionally seed_data).'
	}
]

// the skill-plan card: eyebrow + app title + entity tiles (type · fields · seed count) + aggregates.
const PLAN_VIEW = {
	content: {
		class: 'sp-root',
		children: [
			{
				class: 'sp-eyebrow',
				children: [{ text: 'Skill-Plan' }, { text: '$step', class: 'sp-step' }]
			},
			{ tag: 'h2', class: 'sp-title', text: '$app' },
			{
				class: 'sp-grid',
				children: [
					{
						$each: {
							items: '$entities',
							template: {
								class: 'grid-card',
								children: [
									{ text: '$$type', class: 'grid-card-title' },
									{ text: '$$fieldsLabel', class: 'sp-fields' },
									{ text: '$$seedLabel', class: 'sp-seed' }
								]
							}
						}
					}
				]
			},
			{ text: '$aggLabel', class: 'sp-agg' }
		]
	}
}
const PLAN_LOGIC = `function initState(source){source=source||{};var es=source.entities||[];var out=[];for(var i=0;i<es.length;i++){var e=es[i]||{};out.push({type:String(e.type||'\\u2014'),fieldsLabel:(e.fields||[]).join(' \\u00b7 '),seedLabel:(e.seedRows||0)+' Beispielzeilen'});}var ag=source.aggregates||[];return{app:String(source.app||'\\u2014'),step:String(source.step||'plan'),entities:out,aggLabel:ag.length?('Berechnet: '+ag.join(', ')):''};}
function handleEvent(t, p, s) { return s }`
const PLAN_STYLE = {
	extends: 'brand',
	tokens: {},
	selectors: {
		'.sp-root': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.55rem',
			width: '100%',
			fontFamily: 'var(--font-sans)',
			color: 'var(--text)',
			letterSpacing: '-0.02em'
		},
		'.sp-eyebrow': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.4rem',
			fontSize: 'var(--fs-micro)',
			fontWeight: '600',
			letterSpacing: '0.09em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.sp-eyebrow::before': { content: '"◆"', color: 'var(--brand-accent)', fontSize: '0.85em' },
		'.sp-step': { color: 'var(--brand-accent)', opacity: '0.8' },
		'.sp-title': {
			fontFamily: 'var(--font-display)',
			fontSize: 'var(--fs-title)',
			fontWeight: '500',
			margin: '0'
		},
		'.sp-grid': {
			display: 'grid',
			width: '100%',
			gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))',
			gap: '0.75rem'
		},
		'.sp-fields': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.sp-seed': { fontSize: 'var(--fs-micro)', color: 'var(--brand-accent)', fontWeight: '600' },
		'.sp-agg': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.sp-agg:empty': { display: 'none' }
	}
}
const PLAN_SOURCE = {
	app: 'banking-overview',
	step: 'plan',
	entities: [{ type: 'transaction', fields: ['date', 'name', 'amount', 'category'], seedRows: 4 }],
	aggregates: ['totalBalance']
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the five step actor rows.
	for (let i = 0; i < STEPS.length; i++) {
		const st = STEPS[i]
		const mailbox = {
			description: st.description,
			parameters: {
				type: 'object',
				properties: { ...NAME_PARAM, ...(st.extra ?? {}) },
				required: ['name']
			}
		}
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
			VALUES (${IDS[st.name]}, 'skillify', ${st.name}, ${st.name}, ${JSON.stringify(mailbox)}::jsonb, ${st.vibe ?? null}, false, ${10 + i}, now(), now())
			ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, position = EXCLUDED.position, updated_at = now()
		`.execute(db)
	}
	// 2. the EXPLICIT skillify flow: design fan (create/edit/show) + the promotion pipeline edges.
	const nodes = [
		{ id: 'create_mockup', name: 'Design', actor: 'create_mockup', inputs: ['intent'], outputs: ['mockup'], note: 'GLM designs a screen (view/style/example state) behind the mock- wall.' },
		{ id: 'edit_mockup', name: 'Refine', actor: 'edit_mockup', inputs: ['mockup'], outputs: ['mockup'], note: 'PATCH-based refinement — only changed sections re-authored.' },
		{ id: 'mockups', name: 'Show', actor: 'mockups', inputs: ['intent'], outputs: ['mockup'], note: 'Instant show/list (no LLM).' },
		{ id: 'plan_app', name: 'Plan', actor: 'plan_app', vibe: 'skill-plan', inputs: ['mockup'], outputs: ['plan'], note: 'Deterministic skeleton from the example-source shape.' },
		{ id: 'mint_data', name: 'Mint data', actor: 'mint_data', vibe: 'bundle-created', inputs: ['plan'], outputs: ['bundle'], note: 'Ontology delegation: predicates + bundle + derived ops.' },
		{ id: 'wire_actors', name: 'Wire actors', actor: 'wire_actors', vibe: 'skill-plan', inputs: ['bundle'], outputs: ['skill'], note: 'Skill + data_crud + the smoke-gated sandbox overview actor.' },
		{ id: 'seed_data', name: 'Seed', actor: 'seed_data', vibe: 'todos-created', inputs: ['skill'], outputs: ['data'], note: 'Example rows → real predications (skippable).' },
		{ id: 'promote', name: 'Promote', actor: 'promote', inputs: ['data'], outputs: ['app'], note: 'Vibe rows copied mock→real; the app is live.' }
	]
	const edges = [
		{ from: 'create_mockup', to: 'edit_mockup', kind: 'data' },
		{ from: 'edit_mockup', to: 'plan_app', kind: 'data' },
		{ from: 'plan_app', to: 'mint_data', kind: 'control' },
		{ from: 'mint_data', to: 'wire_actors', kind: 'control' },
		{ from: 'wire_actors', to: 'seed_data', kind: 'control' },
		{ from: 'seed_data', to: 'promote', kind: 'control' }
	]
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, created_at, updated_at)
		VALUES ('skillify', 'Skillify',
			${'Design a screen as a mockup, then PROMOTE it into a real skill — the stepwise pipeline (plan → mint data → wire actors → seed → promote), each step one actor with its own reactable card. The explicit edges ARE the promotion pipeline.'},
			${JSON.stringify(nodes)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
		ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
			nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, updated_at = now()
	`.execute(db)
	// 3. the skill-plan card.
	await sql`INSERT INTO vibe_view (name, body) VALUES ('skill-plan', ${JSON.stringify(PLAN_VIEW)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_style (name, body) VALUES ('skill-plan', ${JSON.stringify(PLAN_STYLE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_logic (name, body) VALUES ('skill-plan', ${PLAN_LOGIC}) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_source (name, body) VALUES ('skill-plan', ${JSON.stringify(PLAN_SOURCE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id IN (${sql.join(Object.values(IDS).map((v) => sql`${v}`))})`.execute(db)
	await sql`DELETE FROM flow WHERE id = 'skillify'`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'skill-plan'`.execute(db)
}
