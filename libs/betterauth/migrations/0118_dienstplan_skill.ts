import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board aven-voice/dienstplan — a RESTAURANT ROSTER skill ("Dienstplan"), authored as pure config in
// one migration (the skillify pattern; mirrors 0080 inventory). It gets its OWN data type `shift`:
// one row = one person working a slot, with a role, a weekday and a start/end time. Batch create/update
// for several people at once rides the generic data_crud `items` array — no per-skill mutation code.
//
// Ontology (consulted first, Lojban-faithful):
//   worker ≡ gunka  — x1 labors/works (the shift row); x2 = the person (prenu) doing it → field `person`
//   role   ≡ jibri  — x1 is a job/occupation of x2; here x2 = the role (Koch/Kellner/Barkeeper) → `role`
//   onday  ≡ detri  — x1 is dated at day x2; x2 = the weekday of the slot → field `day`
//   starts ≡ tcika  — x1 has time-of-day x2; x2 = start HH:MM → field `start`
//   ends   ≡ tcika  — x1 has time-of-day x2; x2 = end   HH:MM → field `end`
//   owned_by (universal singleton) links every shift to the acting user.

// ── vocab (per user, like inventory) ─────────────────────────────────────────
const WORKER: PredicateDef = {
	predicate: 'worker',
	gismu: 'gunka',
	gloss: 'gunka: x1 labors/works (this shift); x2 = the person working it — symbolic id = their name',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row (implicit)', kind: 'ref', references: '*', required: false },
		{ pos: 'x2', role: 'person', gloss: 'WHO works — symbolic id = the person name (prenu)', kind: 'ref', references: '*' }
	]
}
const ROLE: PredicateDef = {
	predicate: 'role',
	gismu: 'jibri',
	gloss: 'jibri: x1 (the shift) is a job/role x2 — Koch, Kellner, Barkeeper …',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'role', gloss: 'the role name (open — Koch/Kellner/Barkeeper …)', kind: 'value', type: 'string' }
	]
}
const ONDAY: PredicateDef = {
	predicate: 'onday',
	gismu: 'detri',
	gloss: 'detri: x1 (the shift) is dated on day x2 — the weekday of the slot',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'day', gloss: 'the weekday (Montag … Sonntag, or an ISO date)', kind: 'value', type: 'string' }
	]
}
const STARTS: PredicateDef = {
	predicate: 'starts',
	gismu: 'tcika',
	gloss: 'tcika: x1 (the shift) begins at time-of-day x2 — start HH:MM',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'start', gloss: 'the start time (e.g. "17:00")', kind: 'value', type: 'string' }
	]
}
const ENDS: PredicateDef = {
	predicate: 'ends',
	gismu: 'tcika',
	gloss: 'tcika: x1 (the shift) ends at time-of-day x2 — end HH:MM',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'end', gloss: 'the end time (e.g. "23:00")', kind: 'value', type: 'string' }
	]
}

// ── the bundle: primary worker + owned_by singleton + role/day/start/end replace traits ──────────────
const SHIFT_SPEC: TypeSpec = {
	type: 'shift',
	parts: [
		{ pred: 'worker', kind: 'primary', field: 'person', create: { x1: '$user', x2: '$value' }, set: { x2: '$value' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'role', kind: 'replace', link: 'x1', field: 'role', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'onday', kind: 'replace', link: 'x1', field: 'day', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'starts', kind: 'replace', link: 'x1', field: 'start', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'ends', kind: 'replace', link: 'x1', field: 'end', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		person: { pred: 'worker', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' },
		role: { pred: 'role', place: 'x2' },
		day: { pred: 'onday', place: 'x2' },
		start: { pred: 'starts', place: 'x2' },
		end: { pred: 'ends', place: 'x2' }
	}
}

// ── the skill + its data_crud actor (generic handler; the mailbox teaches the shift fields) ──────────
const ACTOR_ID = '00000000-0000-0000-0000-0000000118d1'
const SHOW_ACTOR_ID = '00000000-0000-0000-0000-0000000118d2'

const CRUD_MAILBOX = {
	description:
		'Read or modify the restaurant ROSTER (schema "shift"): each shift is one PERSON working a slot, ' +
		'with a role (Koch/Kellner/Barkeeper …), a weekday (Montag … Sonntag) and a start + end time. ' +
		'BATCH-plan several people or days at once via `items` (one object per shift). update/delete need ' +
		'the shift\'s "id" — call `list` first to read the real ids. Use `list` to see the plan.',
	parameters: {
		type: 'object',
		properties: {
			schema: { type: 'string', description: 'Always "shift" on this skill.' },
			action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
			filter: {
				type: 'object',
				description:
					'list only: {"field":<person|role|day|start|end>,"value":…,"op"?:eq|neq}. e.g. {"field":"day","value":"Montag"}.',
				properties: { field: { type: 'string' }, value: {}, op: { type: 'string' } }
			},
			items: {
				type: 'array',
				description:
					'create: {"person":"Anna","role":"Koch","day":"Montag","start":"17:00","end":"23:00"}. ' +
					'update: the same fields plus the shift\'s "id". Send several objects to plan a whole week or team at once.',
				items: { type: 'object', additionalProperties: true }
			},
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['schema', 'action']
	}
}

const SHOW_MAILBOX = {
	description:
		'Show the roster (Dienstplan) as a week overview — every planned shift grouped by weekday. Use ' +
		'whenever the user wants to SEE the plan ("zeig den Dienstplan", "wer arbeitet diese Woche"). Takes no arguments.',
	parameters: { type: 'object', properties: {} }
}

// ── the Skills-explorer hub graph ────────────────────────────────────────────
const DIENSTPLAN_HUB = {
	id: 'dienstplan',
	name: 'Dienstplan',
	description: 'The restaurant roster — plan who works which shift, by role, across the week. Batch-edit multiple people at once.',
	nodes: [
		{ id: 'show', name: 'Show roster', actor: 'show_dienstplan', inputs: ['intent'], outputs: ['shift'], vibe: 'dienstplan', note: 'the week overview, grouped by day.' },
		{ id: 'read', name: 'List shifts', actor: 'data_crud', inputs: ['intent'], outputs: ['shift'], vibe: 'dienstplan', note: 'list — read the planned shifts.' },
		{ id: 'create', name: 'Plan shifts', actor: 'data_crud', inputs: ['intent'], outputs: ['shift'], vibe: 'dienstplan', note: 'create — add one or many shifts (batch).' },
		{ id: 'edit', name: 'Change shift', actor: 'data_crud', inputs: ['intent', 'shift'], outputs: ['shift'], vibe: 'dienstplan', note: 'update — change person/role/day/time by id.' },
		{ id: 'delete', name: 'Remove shift', actor: 'data_crud', inputs: ['intent', 'shift'], outputs: ['shift'], hitl: true, note: 'delete — HITL-confirmed.' }
	],
	edges: [],
	resourceLabels: { intent: 'Intent', shift: 'Shifts' },
	triggers: [{ kind: 'manual' }]
}

// ── the vibe: a week roster grid (7 day columns, shift blocks with person/role/time) ─────────────────
const DIENSTPLAN_VIEW = {
	content: {
		class: 'dp-container',
		children: [
			{
				class: 'dp-card dp-card--head',
				children: [
					{
						children: [
							{ text: '$eyebrow', class: 'dp-eyebrow' },
							{ tag: 'h1', text: '$title', class: 'dp-title' }
						]
					},
					{
						class: 'dp-head-stat',
						children: [
							{ text: '$statLabel', class: 'dp-field-label' },
							{ text: '$statValue', class: 'dp-accent' }
						]
					}
				]
			},
			{
				class: 'dp-card dp-card--week',
				children: [
					{ text: '$emptyMessage', class: 'dp-empty' },
					{
						class: 'dp-week',
						children: [
							{
								$each: {
									items: '$days',
									template: {
										class: '$$dayClass',
										children: [
											{
												class: 'dp-day-head',
												children: [
													{ text: '$$wd', class: 'dp-day-wd' },
													{ text: '$$count', class: 'dp-day-count' }
												]
											},
											{
												$each: {
													items: '$$shifts',
													template: {
														class: '$$shiftClass',
														children: [
															{ text: '$$time', class: 'dp-shift-time' },
															{ text: '$$person', class: 'dp-shift-person' },
															{ text: '$$role', class: 'dp-shift-role' }
														]
													}
												}
											}
										]
									}
								}
							}
						]
					}
				]
			}
		]
	}
}

const DIENSTPLAN_STYLE = {
	// White-label: extend the brand token layer. Role accents are the only added tokens
	// (the todos vibe sets custom prio tokens the same way); everything else is var(--…).
	extends: 'brand',
	tokens: {
		'role-cook': '#b0803a',
		'role-service': '#3f6f8a',
		'role-bar': '#7a5ca8',
		'role-other': 'var(--muted-strong)'
	},
	selectors: {
		'.dp-container': {
			display: 'flex',
			flexDirection: 'column',
			gap: '1rem',
			width: '100%',
			maxWidth: 'var(--max-w)',
			margin: '0 auto',
			fontFamily: 'var(--font-mono)',
			color: 'var(--text)'
		},
		'.dp-card': {
			border: '1px solid var(--border)',
			background: 'var(--surface)',
			borderRadius: 'var(--radius-card)',
			padding: '1.25rem 1.4rem'
		},
		'.dp-card--head': { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem' },
		'.dp-eyebrow': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.dp-title': { fontSize: 'var(--fs-hero)', fontWeight: '600', margin: '0.1rem 0 0' },
		'.dp-head-stat': { textAlign: 'right', flexShrink: '0' },
		'.dp-field-label': {
			fontSize: 'var(--fs-micro)',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.dp-accent': { fontSize: 'var(--fs-amount)', fontWeight: '700', color: 'var(--brand-accent)' },
		'.dp-card--week': { padding: '1.1rem 1.2rem' },
		'.dp-empty': { padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' },
		'.dp-empty:empty': { display: 'none' },
		'.dp-week': { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem' },
		'.dp-day': {
			minWidth: '0',
			display: 'flex',
			flexDirection: 'column',
			gap: '0.4rem',
			padding: '0.5rem 0.45rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid transparent'
		},
		'.dp-day.today': { background: 'var(--surface-2)', border: '1px solid var(--border)' },
		'.dp-day-head': {
			display: 'flex',
			alignItems: 'baseline',
			justifyContent: 'space-between',
			gap: '0.3rem',
			borderBottom: '1px solid var(--border-soft)',
			paddingBottom: '0.35rem'
		},
		'.dp-day-wd': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.dp-day.today .dp-day-wd': { color: 'var(--brand-accent)' },
		'.dp-day-count': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
		'.dp-day-count:empty': { display: 'none' },
		'.dp-shift': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.1rem',
			background: 'var(--surface-2)',
			borderRadius: 'var(--radius-inner)',
			borderLeft: '3px solid var(--role-other)',
			padding: '0.35rem 0.45rem'
		},
		'.dp-day.today .dp-shift': { background: 'var(--surface)' },
		'.dp-shift.cook': { borderLeft: '3px solid var(--role-cook)' },
		'.dp-shift.service': { borderLeft: '3px solid var(--role-service)' },
		'.dp-shift.bar': { borderLeft: '3px solid var(--role-bar)' },
		'.dp-shift-time': { fontSize: 'var(--fs-micro)', color: 'var(--muted-strong)', fontVariantNumeric: 'tabular-nums' },
		'.dp-shift-time:empty': { display: 'none' },
		'.dp-shift-person': { fontSize: 'var(--fs-label)', fontWeight: '600', lineHeight: '1.25', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.dp-shift-role': { fontSize: 'var(--fs-micro)', color: 'var(--role-other)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-eyebrow)' },
		'.dp-shift-role:empty': { display: 'none' },
		'.dp-shift.cook .dp-shift-role': { color: 'var(--role-cook)' },
		'.dp-shift.service .dp-shift-role': { color: 'var(--role-service)' },
		'.dp-shift.bar .dp-shift-role': { color: 'var(--role-bar)' },
		'@media (max-width: 640px)': { '.dp-week': { gridTemplateColumns: '1fr' } }
	}
}

const DIENSTPLAN_LOGIC = `
var WD_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
var WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// weekday index (Mo=0 … So=6) from a free day string or an ISO date; null if unknown.
function dayIndex(day) {
	var s = String(day || '').trim().toLowerCase()
	if (!s) return null
	var table = [
		['montag', 0], ['monday', 0], ['mon', 0], ['mo', 0],
		['dienstag', 1], ['tuesday', 1], ['tue', 1], ['di', 1],
		['mittwoch', 2], ['wednesday', 2], ['wed', 2], ['mi', 2],
		['donnerstag', 3], ['thursday', 3], ['thu', 3], ['do', 3],
		['freitag', 4], ['friday', 4], ['fri', 4], ['fr', 4],
		['sonnabend', 5], ['samstag', 5], ['saturday', 5], ['sat', 5], ['sa', 5],
		['sonntag', 6], ['sunday', 6], ['sun', 6], ['so', 6]
	]
	for (var i = 0; i < table.length; i++) {
		if (s.indexOf(table[i][0]) === 0) return table[i][1]
	}
	var d = new Date(day)
	if (!isNaN(d.getTime())) return (d.getDay() + 6) % 7
	return null
}

// role → color bucket for the left accent (display only).
function roleKind(role) {
	var s = String(role || '').toLowerCase()
	if (s.indexOf('koch') !== -1 || s.indexOf('köch') !== -1 || s.indexOf('cook') !== -1 || s.indexOf('küche') !== -1 || s.indexOf('chef') !== -1) return 'cook'
	if (s.indexOf('kellner') !== -1 || s.indexOf('service') !== -1 || s.indexOf('waiter') !== -1 || s.indexOf('servier') !== -1) return 'service'
	if (s.indexOf('bar') !== -1 || s.indexOf('theke') !== -1) return 'bar'
	return 'other'
}

function startMinutes(t) {
	var m = String(t || '').match(/(\\d{1,2}):(\\d{2})/)
	if (!m) return 9999
	return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function timeLabel(s) {
	var a = String(s.start || '').trim()
	var b = String(s.end || '').trim()
	if (a && b) return a + '–' + b
	return a || b || ''
}

function initState(source) {
	source = source || {}
	var items = source.items || []
	var now = new Date()
	var todayIdx = (now.getDay() + 6) % 7

	var days = []
	for (var i = 0; i < 7; i++) {
		days.push({
			wd: WD_SHORT[i],
			full: WD_FULL[i],
			dayClass: 'dp-day' + (i === todayIdx ? ' today' : ''),
			count: '',
			shifts: []
		})
	}

	var people = {}
	var planned = 0
	for (var k = 0; k < items.length; k++) {
		var it = items[k] || {}
		var idx = dayIndex(it.day)
		if (idx === null) continue
		var kind = roleKind(it.role)
		days[idx].shifts.push({
			person: String(it.person || it.name || '—'),
			role: String(it.role || ''),
			time: timeLabel(it),
			shiftClass: 'dp-shift ' + kind,
			_m: startMinutes(it.start)
		})
		if (it.person) people[String(it.person).toLowerCase()] = true
		planned++
	}
	for (var g = 0; g < 7; g++) {
		days[g].shifts.sort(function (a, b) { return a._m - b._m })
		days[g].count = days[g].shifts.length ? String(days[g].shifts.length) : ''
	}

	var peopleCount = 0
	for (var p in people) if (people.hasOwnProperty(p)) peopleCount++

	return {
		eyebrow: 'Dienstplan',
		title: 'Wochenübersicht',
		statLabel: 'Schichten',
		statValue: String(planned),
		days: days,
		isEmpty: planned === 0,
		emptyMessage: planned === 0
			? 'Noch keine Schichten geplant — sag z. B. „Anna am Montag 17 bis 23 Uhr als Köchin".'
			: ''
	}
}

function handleEvent(type, payload, state) {
	return state
}
`

async function upsertJson(
	db: Kysely<unknown>,
	table: 'vibe_view' | 'vibe_style',
	name: string,
	value: unknown
): Promise<void> {
	await sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}
async function upsertLogic(db: Kysely<unknown>, name: string, body: string): Promise<void> {
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES (${name}, ${body})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		// 1. vocab for every existing user (fresh users seed via the runtime vocab path).
		const users = await sql<{ user_id: string }>`
			SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL
		`.execute(db)
		for (const def of [WORKER, ROLE, ONDAY, STARTS, ENDS]) {
			const body = JSON.stringify(compilePredicate(def))
			for (const { user_id } of users.rows) {
				const existing = await sql<{ id: string }>`
					SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = ${def.predicate} LIMIT 1
				`.execute(db)
				if (existing.rows[0]) {
					await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(db)
				} else {
					await sql`
						INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
						VALUES (${randomUUID()}, ${user_id}, ${def.predicate}, ${body}::jsonb, now(), now())
					`.execute(db)
				}
			}
		}

		// 2. the bundle (derives shift.list/create/update/delete).
		await saveType(SHIFT_SPEC)

		// 3. the skill row (router menu) + its actors.
		await sql`
			INSERT INTO skill (id, label, description, manifest, position, created_at, updated_at)
			VALUES ('dienstplan', 'Dienstplan',
				${'the restaurant staff roster (Dienstplan/Schichtplan): plan who works which shift by role (Koch/Kellner/Barkeeper) across the week, see the week overview, and batch-edit multiple people at once. Ask "zeig den Dienstplan" or "plane Anna am Montag als Köchin".'},
				${JSON.stringify({ vibe: 'dienstplan', schema: 'shift' })}::jsonb, 9, now(), now())
			ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
				manifest = EXCLUDED.manifest, position = EXCLUDED.position, updated_at = now()
		`.execute(db)
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
			VALUES (${ACTOR_ID}, 'dienstplan', 'data_crud', 'data_crud', ${JSON.stringify(CRUD_MAILBOX)}::jsonb, 'dienstplan', false, 1, now(), now())
			ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
		`.execute(db)
		// explicit display tool (mirrors show_calendar): always lands on the roster vibe.
		await sql`
			INSERT INTO actor (id, skill_id, name, mailbox, vibe, hitl, position, created_at, updated_at)
			VALUES (${SHOW_ACTOR_ID}, 'dienstplan', 'show_dienstplan', ${JSON.stringify(SHOW_MAILBOX)}::jsonb, 'dienstplan', false, 0, now(), now())
			ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
		`.execute(db)

		// 4. the hub graph.
		await sql`
			INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
			VALUES (${DIENSTPLAN_HUB.id}, ${DIENSTPLAN_HUB.name}, ${DIENSTPLAN_HUB.description},
				${JSON.stringify(DIENSTPLAN_HUB.nodes)}::jsonb, ${JSON.stringify(DIENSTPLAN_HUB.edges)}::jsonb,
				${JSON.stringify(DIENSTPLAN_HUB.triggers)}::jsonb, ${JSON.stringify(DIENSTPLAN_HUB.resourceLabels)}::jsonb)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
				nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, triggers = EXCLUDED.triggers,
				resource_labels = EXCLUDED.resource_labels, updated_at = now()
		`.execute(db)

		// 5. the vibe.
		await upsertJson(db, 'vibe_view', 'dienstplan', DIENSTPLAN_VIEW)
		await upsertJson(db, 'vibe_style', 'dienstplan', DIENSTPLAN_STYLE)
		await upsertLogic(db, 'dienstplan', DIENSTPLAN_LOGIC)
	} catch (e) {
		// REPLAY-SAFE SKIP (board 0119j): runs today's engine against the historical schema; a fresh
		// catch-up may reject it even though the real run succeeds. Skipping is convergent and LOGGED.
		console.error('[migrate 0118] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id IN (${ACTOR_ID}, ${SHOW_ACTOR_ID})`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'dienstplan'`.execute(db)
	await sql`DELETE FROM flow WHERE id = 'dienstplan'`.execute(db)
	await sql`DELETE FROM data_operations WHERE derived_from = 'shift'`.execute(db)
	await sql`DELETE FROM data_bundles WHERE type = 'shift'`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'dienstplan'`.execute(db)
}
