import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board aven-voice/kontakte — an ADDRESSBOOK of people (prenu) as first-class ENTITIES, so the roster
// and todos can reference real persons instead of loose name strings. Mirrors the reified goal/location
// entity pattern (identity-only primary + universal `named` label + owned_by), plus optional phone/role.
// Ontology: prenu ≡ prenu (x1 is a person); the name lives on named≡cmene; phone on fonxa≡telephone;
// a default role reuses role≡jibri.

const PRENU: PredicateDef = {
	predicate: 'prenu',
	gismu: 'prenu',
	gloss: 'prenu: x1 is a person/human — a contact entity (its name lives on `named`)',
	places: [
		{ pos: 'x1', role: 'person', gloss: 'the person entity (the row itself)', kind: 'ref', references: '*', required: false },
		{ pos: 'x2', role: 'attr', gloss: 'open — the display name rides the `named` label', kind: 'value', type: 'string', required: false }
	]
}
const FONXA: PredicateDef = {
	predicate: 'fonxa',
	gismu: 'fonxa',
	gloss: 'fonxa: x1 (the person) has telephone number x2',
	places: [
		{ pos: 'x1', role: 'person', gloss: 'the person row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'phone', gloss: 'the phone number (e.g. "+49 …")', kind: 'value', type: 'string' }
	]
}

// entity bundle: identity primary + name + owner + optional phone + optional default role.
const PRENU_SPEC: TypeSpec = {
	type: 'prenu',
	parts: [
		{ pred: 'prenu', kind: 'primary' },
		{ pred: 'named', kind: 'replace', link: 'x2', field: 'name', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'fonxa', kind: 'replace', link: 'x1', field: 'phone', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'role', kind: 'replace', link: 'x1', field: 'role', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		name: { pred: 'named', place: 'x1' },
		owner: { pred: 'owned_by', place: 'x1' },
		phone: { pred: 'fonxa', place: 'x2' },
		role: { pred: 'role', place: 'x2' }
	}
}

const ACTOR_ID = '00000000-0000-0000-0000-0000000124c1'

const MAILBOX = {
	description:
		'Read or modify the ADDRESSBOOK (schema "prenu"): the people/contacts — each has a name, an ' +
		'optional default role (Koch/Kellner/…) and an optional phone. BATCH via `items`; update/delete ' +
		'need the row "id" (list first). These people are who the roster (Dienstplan) and todos are ' +
		'assigned to.',
	parameters: {
		type: 'object',
		properties: {
			schema: { type: 'string', description: 'Always "prenu" on this skill.' },
			action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
			filter: {
				type: 'object',
				description: 'list only: {"field":<name|role|phone>,"value":…}.',
				properties: { field: { type: 'string' }, value: {}, op: { type: 'string' } }
			},
			items: {
				type: 'array',
				description: 'create: {"name":"Anna","role":"Koch","phone":"+49 …"}. update: same fields + the row "id".',
				items: { type: 'object', additionalProperties: true }
			},
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['schema', 'action']
	}
}

// ── the contacts vibe: a clean people list (name · role · phone), role-coloured accent ──────────────
const KONTAKTE_VIEW = {
	content: {
		class: 'kt-container',
		children: [
			{
				class: 'kt-card kt-card--head',
				children: [
					{
						children: [
							{ text: '$eyebrow', class: 'kt-eyebrow' },
							{ tag: 'h1', text: '$title', class: 'kt-title' }
						]
					},
					{
						class: 'kt-head-stat',
						children: [
							{ text: '$statLabel', class: 'kt-field-label' },
							{ text: '$statValue', class: 'kt-accent' }
						]
					}
				]
			},
			{
				class: 'kt-card kt-card--list',
				children: [
					{ text: '$emptyMessage', class: 'kt-empty' },
					{
						tag: 'ul',
						class: 'kt-list',
						children: [
							{
								$each: {
									items: '$people',
									template: {
										tag: 'li',
										class: '$$rowClass',
										children: [
											{ class: 'kt-dot' },
											{ text: '$$name', class: 'kt-name' },
											{ text: '$$role', class: 'kt-role' },
											{ text: '$$phone', class: 'kt-phone' }
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

const KONTAKTE_STYLE = {
	extends: 'brand',
	tokens: {
		'role-cook': '#b0803a',
		'role-service': '#3f6f8a',
		'role-bar': '#7a5ca8',
		'role-other': 'var(--muted-strong)'
	},
	selectors: {
		'.kt-container': {
			display: 'flex',
			flexDirection: 'column',
			gap: '1rem',
			width: '100%',
			maxWidth: 'var(--max-w)',
			margin: '0 auto',
			fontFamily: 'var(--font-mono)',
			color: 'var(--text)'
		},
		'.kt-card': {
			border: '1px solid var(--border)',
			background: 'var(--surface)',
			borderRadius: 'var(--radius-card)',
			padding: '1.25rem 1.4rem'
		},
		'.kt-card--head': { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem' },
		'.kt-eyebrow': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.kt-title': { fontSize: 'var(--fs-hero)', fontWeight: '600', margin: '0.1rem 0 0' },
		'.kt-head-stat': { textAlign: 'right', flexShrink: '0' },
		'.kt-field-label': {
			fontSize: 'var(--fs-micro)',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.kt-accent': { fontSize: 'var(--fs-amount)', fontWeight: '700', color: 'var(--brand-accent)' },
		'.kt-card--list': { padding: '0.5rem 0.6rem' },
		'.kt-empty': { padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' },
		'.kt-empty:empty': { display: 'none' },
		'.kt-list': { listStyle: 'none', margin: '0', padding: '0' },
		'.kt-row': {
			display: 'flex',
			alignItems: 'center',
			gap: '0.8rem',
			padding: '0.6rem 0.8rem',
			borderBottom: '1px solid var(--border-soft)'
		},
		'.kt-dot': {
			minWidth: '8px',
			maxWidth: '8px',
			height: '8px',
			borderRadius: 'var(--radius-pill)',
			background: 'var(--role-other)',
			flexShrink: '0'
		},
		'.kt-row.cook .kt-dot': { background: 'var(--role-cook)' },
		'.kt-row.service .kt-dot': { background: 'var(--role-service)' },
		'.kt-row.bar .kt-dot': { background: 'var(--role-bar)' },
		'.kt-name': { fontSize: 'var(--fs-body)', fontWeight: '600', flex: '1', minWidth: '0' },
		'.kt-role': {
			fontSize: 'var(--fs-micro)',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--role-other)',
			flexShrink: '0'
		},
		'.kt-role:empty': { display: 'none' },
		'.kt-row.cook .kt-role': { color: 'var(--role-cook)' },
		'.kt-row.service .kt-role': { color: 'var(--role-service)' },
		'.kt-row.bar .kt-role': { color: 'var(--role-bar)' },
		'.kt-phone': { fontSize: 'var(--fs-label)', color: 'var(--muted-strong)', fontVariantNumeric: 'tabular-nums', flexShrink: '0' },
		'.kt-phone:empty': { display: 'none' }
	}
}

const KONTAKTE_LOGIC = `
function roleKind(role) {
	var s = String(role || '').toLowerCase()
	if (s.indexOf('koch')!==-1||s.indexOf('köch')!==-1||s.indexOf('cook')!==-1||s.indexOf('küche')!==-1||s.indexOf('chef')!==-1) return 'cook'
	if (s.indexOf('kellner')!==-1||s.indexOf('service')!==-1||s.indexOf('waiter')!==-1||s.indexOf('servier')!==-1) return 'service'
	if (s.indexOf('bar')!==-1||s.indexOf('theke')!==-1) return 'bar'
	return 'other'
}
function initState(source) {
	source = source || {}
	var items = source.items || []
	var people = []
	for (var i = 0; i < items.length; i++) {
		var it = items[i] || {}
		people.push({
			name: String(it.name || '—'),
			role: String(it.role || ''),
			phone: String(it.phone || ''),
			rowClass: 'kt-row ' + roleKind(it.role)
		})
	}
	people.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1 })
	return {
		eyebrow: 'Adressbuch',
		title: 'Kontakte',
		statLabel: 'Personen',
		statValue: String(people.length),
		people: people,
		isEmpty: people.length === 0,
		emptyMessage: people.length === 0 ? 'Noch keine Kontakte — sag z. B. „Neuer Kontakt Anna, Köchin".' : ''
	}
}
function handleEvent(type, payload, state) { return state }
`

async function upsertJson(db: Kysely<unknown>, table: 'vibe_view' | 'vibe_style', name: string, value: unknown): Promise<void> {
	await sql`INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		// 1. vocab per user (named/role/owned_by already exist).
		const users = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL`.execute(db)
		for (const def of [PRENU, FONXA]) {
			const body = JSON.stringify(compilePredicate(def))
			for (const { user_id } of users.rows) {
				const ex = await sql<{ id: string }>`SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = ${def.predicate} LIMIT 1`.execute(db)
				if (ex.rows[0]) await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${ex.rows[0].id}`.execute(db)
				else await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at) VALUES (${randomUUID()}, ${user_id}, ${def.predicate}, ${body}::jsonb, now(), now())`.execute(db)
			}
		}

		// 2. the prenu bundle (derives prenu.list/create/update/delete).
		await saveType(PRENU_SPEC)

		// 3. the skill + data_crud actor.
		await sql`
			INSERT INTO skill (id, label, description, position, created_at, updated_at)
			VALUES ('kontakte', 'Kontakte', ${'the addressbook of people/contacts (prenu): names with an optional role and phone — who the roster and todos are assigned to. Ask "zeig meine Kontakte" or "neuer Kontakt Anna als Köchin".'}, 10, now(), now())
			ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now()
		`.execute(db)
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
			VALUES (${ACTOR_ID}, 'kontakte', 'data_crud', 'data_crud', ${JSON.stringify(MAILBOX)}::jsonb, 'kontakte', false, 1, now(), now())
			ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
		`.execute(db)

		// 4. the contacts vibe.
		await upsertJson(db, 'vibe_view', 'kontakte', KONTAKTE_VIEW)
		await upsertJson(db, 'vibe_style', 'kontakte', KONTAKTE_STYLE)
		await sql`INSERT INTO vibe_logic (name, body) VALUES ('kontakte', ${KONTAKTE_LOGIC})
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	} catch (e) {
		console.error('[migrate 0124] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ACTOR_ID}`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'kontakte'`.execute(db)
	await sql`DELETE FROM data_operations WHERE derived_from = 'prenu'`.execute(db)
	await sql`DELETE FROM data_bundles WHERE type = 'prenu'`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'kontakte'`.execute(db)
}
