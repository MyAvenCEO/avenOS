import { type Kysely, sql } from 'kysely'

// board aven-voice/calendar — a CALENDAR skill as a time-oriented VIEW over the
// SAME task+due (detri) predications todos writes. No schema duplication: the
// skill's manifest.schema = 'todos', so calendar reads/writes the identical
// data hub; it only renders differently (Heute / Diese Woche / Später buckets).
// The interval gismu `temci` (timed events with a duration) is minted per-user
// through the ontology skill, not seeded here (schemas are per-user).

// ── The skill (config-as-data): routable, reuses the todos data + data_crud ──
const CALENDAR_SKILL = {
	id: 'calendar',
	label: 'Calendar',
	description:
		'a time view over your tasks — see what is due today, this week, or later, grouped by day. ' +
		'Reads the same tasks as todos (shared due dates); ask "zeig meinen Kalender" or "was steht diese Woche an".',
	manifest: { vibe: 'calendar', schema: 'todos' },
	position: 8
}

// The calendar's read actor: data_crud on the todos schema, rendered by the
// calendar vibe. Same tool the chat/voice loop already routes.
const CALENDAR_ACTOR_MAILBOX = {
	description:
		'Read the signed-in user\'s tasks (schema "todos") to show them on the calendar. Use action "list" ' +
		'to display everything due; create/update/delete also work (shared with the todos hub) — pass a due ' +
		'(ISO date) so the task lands on the right day.',
	parameters: {
		type: 'object',
		required: ['schema', 'action'],
		properties: {
			schema: { type: 'string', description: 'Always "todos" on this skill (calendar shares todo data).' },
			action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			items: {
				type: 'array',
				items: { type: 'object', additionalProperties: true },
				description: 'create/update value objects: { title, due (ISO date), priority, done }.'
			},
			filter: { type: 'object', additionalProperties: true }
		}
	}
}

const SHOW_CALENDAR_MAILBOX = {
	description:
		'Show the CALENDAR view of the user\'s tasks — grouped into today / this week / later by due date. ' +
		'Use whenever the user wants to SEE their schedule/calendar/what is coming up. Takes no arguments.',
	parameters: { type: 'object', properties: {} }
}

// ── The hub visualization (Skills explorer) ──
const CALENDAR_HUB = {
	id: 'calendar',
	name: 'Calendar',
	description: 'A time view over tasks — read/create/edit/remove, grouped by day. Shares the todos data hub.',
	nodes: [
		{ id: 'read', name: 'Show calendar', actor: 'data_crud', inputs: ['intent'], outputs: ['todos'], vibe: 'calendar', note: 'list — group tasks by day (today / this week / later).' },
		{ id: 'create', name: 'Schedule task', actor: 'data_crud', inputs: ['intent'], outputs: ['todos'], vibe: 'calendar', note: 'create — add a task with a due date.' },
		{ id: 'edit', name: 'Reschedule task', actor: 'data_crud', inputs: ['intent', 'todos'], outputs: ['todos'], vibe: 'calendar', note: 'update — change a task\'s due date.' },
		{ id: 'delete', name: 'Remove task', actor: 'data_crud', inputs: ['intent', 'todos'], outputs: ['todos'], vibe: 'calendar', hitl: true, note: 'delete — HITL-confirmed.' }
	],
	edges: [],
	resourceLabels: { intent: 'Intent', todos: 'Tasks' },
	triggers: [{ kind: 'manual' }]
}

// ── The calendar vibe: view (declarative tree), style (CSS), logic (buckets) ──
const CALENDAR_VIEW = {
	content: {
		class: 'cal-container',
		children: [
			{
				class: 'cal-card cal-card--head',
				children: [
					{
						children: [
							{ text: '$eyebrow', class: 'cal-eyebrow' },
							{ tag: 'h1', text: '$title', class: 'cal-title' }
						]
					},
					{
						class: 'cal-head-stat',
						children: [
							{ text: '$dueLabel', class: 'cal-field-label' },
							{ text: '$dueCount', class: 'cal-accent' }
						]
					}
				]
			},
			{
				class: 'cal-card cal-card--list',
				children: [
					{
						tag: 'ul',
						class: 'cal-list',
						children: [
							{ tag: 'li', text: '$emptyMessage', attrs: { 'data-empty': 'true' }, class: 'cal-empty' },
							{
								$each: {
									items: '$rows',
									template: {
										tag: 'li',
										attrs: { 'data-kind': '$$kind' },
										class: '$$rowClass',
										children: [
											{ text: '$$header', class: 'cal-section' },
											{ text: '$$count', class: 'cal-section-count' },
											{ class: 'cal-dot' },
											{ text: '$$text', class: 'cal-row-text' },
											{ text: '$$time', class: 'cal-chip cal-chip--time' },
											{ text: '$$priority', class: 'cal-chip cal-chip--prio' }
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

const CALENDAR_STYLE = {
	// White-label: extend the brand token layer — every color/radius/font comes
	// from var(--…) brand tokens (danger/ok/muted/surface/…), nothing hardcoded.
	extends: 'brand',
	tokens: {},
	selectors: {
		'.cal-container': {
			display: 'flex',
			flexDirection: 'column',
			gap: '1rem',
			width: '100%',
			maxWidth: 'var(--max-w)',
			margin: '0 auto',
			fontFamily: 'var(--font-mono)',
			color: 'var(--text)'
		},
		'.cal-card': {
			border: '1px solid var(--border)',
			background: 'var(--surface)',
			borderRadius: 'var(--radius-card)',
			padding: '1.25rem 1.4rem'
		},
		'.cal-card--head': {
			display: 'flex',
			alignItems: 'flex-end',
			justifyContent: 'space-between',
			gap: '1rem'
		},
		'.cal-eyebrow': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.cal-title': { fontSize: 'var(--fs-hero)', fontWeight: '600', margin: '0.1rem 0 0' },
		'.cal-head-stat': { textAlign: 'right', flexShrink: '0' },
		'.cal-field-label': {
			fontSize: 'var(--fs-micro)',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.cal-accent': { fontSize: 'var(--fs-amount)', fontWeight: '700', color: 'var(--brand-accent)' },
		'.cal-card--list': { padding: '0.6rem 0.4rem' },
		'.cal-list': { listStyle: 'none', margin: '0', padding: '0' },
		'.cal-empty': { padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' },
		'.cal-row': {
			display: 'flex',
			alignItems: 'center',
			gap: '0.8rem',
			padding: '0.6rem 1rem',
			borderBottom: '1px solid var(--border-soft)'
		},
		'.cal-row.section': { paddingTop: '1rem', paddingBottom: '0.35rem', borderBottom: 'none', gap: '0.5rem' },
		'.cal-section': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted-strong)'
		},
		'.cal-section:empty': { display: 'none' },
		'.cal-section-count': { fontSize: 'var(--fs-micro)', fontWeight: '700', color: 'var(--muted)' },
		'.cal-section-count:empty': { display: 'none' },
		'.cal-dot': {
			minWidth: '7px',
			maxWidth: '7px',
			height: '7px',
			borderRadius: 'var(--radius-pill)',
			background: 'var(--muted)',
			flex: '0 0 auto'
		},
		'.cal-row.section .cal-dot': { display: 'none' },
		'.cal-row.overdue .cal-dot': { background: 'var(--danger)' },
		'.cal-row.today .cal-dot': { background: 'var(--ok)' },
		'.cal-row-text': { flex: '1', minWidth: '0', fontSize: 'var(--fs-body)' },
		'.cal-row-text:empty': { display: 'none' },
		'.cal-chip': {
			display: 'inline-flex',
			alignItems: 'center',
			flexShrink: '0',
			borderRadius: 'var(--radius-pill)',
			border: '1px solid var(--border)',
			background: 'var(--surface-2)',
			padding: '0.15rem 0.6rem',
			fontSize: 'var(--fs-label)',
			color: 'var(--muted-strong)'
		},
		'.cal-chip:empty': { display: 'none' },
		'.cal-chip--time': { fontVariantNumeric: 'tabular-nums' },
		'.cal-row.overdue .cal-chip--time': { color: 'var(--danger)', borderColor: 'var(--danger)' }
	}
}

// ES5-style (sandbox-quickjs): bucket tasks by their relative due label into
// Überfällig / Heute / Diese Woche / Später / Ohne Frist, as a flat sectioned
// list (header rows carry `header`, task rows carry `text`). Read-only:
// changes come from voice/chat, not an inline form.
const CALENDAR_LOGIC = `
function pad(n) { return (n < 10 ? '0' : '') + n }

// Real rows carry due as an ISO string ("2026-07-18T14:00:00Z"); parse that
// first. Relative labels ("in 2 Tagen", "heute") stay as a fallback so the
// view also works when a producer hands it derived labels.
// Returns { d, allDay }: date-only strings ("2026-07-17") are ALL-DAY and
// parsed as LOCAL dates (new Date('YYYY-MM-DD') would be UTC midnight and
// shift to 02:00 local). A T00:00 timestamp is treated as all-day too — the
// model writes midnight when the user gave no time.
function parseDue(it) {
	var raw = String(it.dueIso || it.dueRaw || it.due || '')
	if (!raw) return null
	var dm = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (dm) return { d: new Date(+dm[1], +dm[2] - 1, +dm[3]), allDay: true }
	var d = new Date(raw)
	if (isNaN(d.getTime())) return null
	return { d: d, allDay: /[T ]00:00/.test(raw) }
}

function labelDays(label) {
	if (!label) return null
	var s = String(label).toLowerCase()
	if (s.indexOf('overdue') !== -1) {
		var mo = s.match(/(\\d+)/)
		return mo ? -parseInt(mo[1], 10) : -1
	}
	if (s.indexOf('today') !== -1 || s.indexOf('heute') !== -1) return 0
	if (s.indexOf('tomorrow') !== -1 || s.indexOf('morgen') !== -1) return 1
	var m = s.match(/(\\d+)/)
	if (m && s.indexOf('in ') !== -1) return parseInt(m[1], 10)
	return null
}

function daysUntil(d) {
	var now = new Date()
	var a = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	var b = new Date(d.getFullYear(), d.getMonth(), d.getDate())
	return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function bucketOf(days) {
	if (days === null) return 4
	if (days < 0) return 0
	if (days === 0) return 1
	if (days <= 6) return 2
	return 3
}

var BUCKETS = [
	{ label: 'Überfällig', kind: 'overdue' },
	{ label: 'Heute', kind: 'today' },
	{ label: 'Diese Woche', kind: 'week' },
	{ label: 'Später', kind: 'later' },
	{ label: 'Ohne Frist', kind: 'none' }
]

var WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

// Human chip: today → "14:00" / "heute"; this week → "Sa 14:00"; else "18.07.".
function chipLabel(d, days, allDay) {
	if (d === null) return ''
	var hasTime = !allDay
	var hh = pad(d.getHours()) + ':' + pad(d.getMinutes())
	var dd = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'
	if (days === 0) return hasTime ? hh : 'heute'
	if (days > 0 && days <= 6) return WEEKDAYS[d.getDay()] + (hasTime ? ' ' + hh : '')
	return dd + (hasTime ? ' ' + hh : '')
}

function initState(source) {
	source = source || {}
	var items = (source.items || []).filter(function (it) { return !it.done })
	var groups = [[], [], [], [], []]
	for (var i = 0; i < items.length; i++) {
		var it = items[i]
		var due = parseDue(it)
		var days = due ? daysUntil(due.d) : labelDays(it.due)
		var b = bucketOf(days)
		// A calendar shows SCHEDULED work only — tasks without a due date live
		// in the todos list, not here.
		if (b === 4) continue
		groups[b].push({
			text: it.text || it.title || '',
			time: due ? chipLabel(due.d, days, due.allDay) : String(it.due || ''),
			priority: it.priority || '',
			kind: BUCKETS[b].kind,
			ts: due ? due.d.getTime() : 9007199254740991
		})
	}
	var rows = []
	var dueCount = 0
	for (var g = 0; g < groups.length; g++) {
		var list = groups[g]
		if (!list.length) continue
		list.sort(function (a, b) { return a.ts - b.ts })
		rows.push({ header: BUCKETS[g].label, count: String(list.length), text: '', time: '', priority: '', kind: BUCKETS[g].kind, rowClass: 'cal-row section ' + BUCKETS[g].kind })
		for (var j = 0; j < list.length; j++) {
			var r = list[j]
			if (g <= 2) dueCount++
			rows.push({ header: '', count: '', text: r.text, time: r.time, priority: r.priority, kind: r.kind, rowClass: 'cal-row ' + r.kind })
		}
	}
	return {
		eyebrow: 'Kalender',
		title: 'Was ansteht',
		dueLabel: 'Heute + diese Woche',
		dueCount: String(dueCount),
		rows: rows,
		isEmpty: rows.length === 0,
		emptyMessage: 'Keine terminierten Aufgaben — sag z. B. „Zahnarzt morgen 10 Uhr".'
	}
}

function handleEvent(type, payload, state) {
	return state
}
`

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO skill (id, label, description, manifest, position)
		VALUES (${CALENDAR_SKILL.id}, ${CALENDAR_SKILL.label}, ${CALENDAR_SKILL.description},
			${JSON.stringify(CALENDAR_SKILL.manifest)}::jsonb, ${CALENDAR_SKILL.position})
		ON CONFLICT (id) DO UPDATE SET
			label = EXCLUDED.label, description = EXCLUDED.description,
			manifest = EXCLUDED.manifest, position = EXCLUDED.position, updated_at = now()
	`.execute(db)

	await sql`
		INSERT INTO actor (id, skill_id, name, mailbox, vibe, hitl, position)
		VALUES ('calendar-data_crud', 'calendar', 'data_crud', ${JSON.stringify(CALENDAR_ACTOR_MAILBOX)}::jsonb, 'todos', false, 1)
		ON CONFLICT (id) DO UPDATE SET
			mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, position = EXCLUDED.position, updated_at = now()
	`.execute(db)

	// Explicit display tool: render the calendar view over the current tasks.
	// Distinct from data_crud (which mutates + shows the todos list) so "zeig
	// meinen Kalender" always lands on the calendar vibe. Mirrors show_website.
	await sql`
		INSERT INTO actor (id, skill_id, name, mailbox, vibe, hitl, position)
		VALUES ('calendar-show', 'calendar', 'show_calendar', ${JSON.stringify(SHOW_CALENDAR_MAILBOX)}::jsonb, 'calendar', false, 0)
		ON CONFLICT (id) DO UPDATE SET
			mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, position = EXCLUDED.position, updated_at = now()
	`.execute(db)

	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
		VALUES (${CALENDAR_HUB.id}, ${CALENDAR_HUB.name}, ${CALENDAR_HUB.description},
			${JSON.stringify(CALENDAR_HUB.nodes)}::jsonb, ${JSON.stringify(CALENDAR_HUB.edges)}::jsonb,
			${JSON.stringify(CALENDAR_HUB.triggers)}::jsonb, ${JSON.stringify(CALENDAR_HUB.resourceLabels)}::jsonb)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description, nodes = EXCLUDED.nodes,
			edges = EXCLUDED.edges, triggers = EXCLUDED.triggers, resource_labels = EXCLUDED.resource_labels, updated_at = now()
	`.execute(db)

	await sql`INSERT INTO vibe_view (name, body) VALUES ('calendar', ${JSON.stringify(CALENDAR_VIEW)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`.execute(db)
	await sql`INSERT INTO vibe_style (name, body) VALUES ('calendar', ${JSON.stringify(CALENDAR_STYLE)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`.execute(db)
	await sql`INSERT INTO vibe_logic (name, body) VALUES ('calendar', ${CALENDAR_LOGIC})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM vibe_logic WHERE name = 'calendar'`.execute(db)
	await sql`DELETE FROM vibe_style WHERE name = 'calendar'`.execute(db)
	await sql`DELETE FROM vibe_view WHERE name = 'calendar'`.execute(db)
	await sql`DELETE FROM actor WHERE skill_id = 'calendar'`.execute(db)
	await sql`DELETE FROM flow WHERE id = 'calendar'`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'calendar'`.execute(db)
}
