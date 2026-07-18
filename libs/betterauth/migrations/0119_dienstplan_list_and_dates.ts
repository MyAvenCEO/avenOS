import { type Kysely, sql } from 'kysely'

// board aven-voice/dienstplan follow-ups:
//  1. Week grid: show the REAL dates of the target week (big day numbers) + the ISO calendar week (KW),
//     and a weekOffset so voice can page weeks ("zeig nächste Woche" → show_dienstplan week=1).
//  2. A second vibe `dienstplan-list`: the shifts grouped PER PERSON (a clean list — "alle Schichten
//     von Anna"). The `list` action renders it; `show_dienstplan` keeps the week grid.
//  3. show_dienstplan gains an optional `week` argument (0=this, 1=next, -1=last …).

const SHOW_ACTOR_ID = '00000000-0000-0000-0000-0000000118d2'

const SHOW_MAILBOX = {
	description:
		'Show the roster (Dienstplan) as a week overview — every planned shift grouped by weekday, with the ' +
		'real dates + calendar week. Use whenever the user wants to SEE the plan. Optional `week`: 0 = this ' +
		'week (default), 1 = next week, -1 = last week, 2 = the week after, etc.',
	parameters: {
		type: 'object',
		properties: {
			week: { type: 'integer', description: 'Week offset from this week: 0 (default), 1 = next, -1 = last.' }
		}
	}
}

// ── grid view: day header now carries weekday + BIG date number + count; head shows KW + date range ──
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
							{ tag: 'h1', text: '$title', class: 'dp-title' },
							{ text: '$subtitle', class: 'dp-subtitle' }
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
													{
														class: 'dp-day-head-l',
														children: [
															{ text: '$$wd', class: 'dp-day-wd' },
															{ text: '$$dnum', class: 'dp-day-num' }
														]
													},
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
		'.dp-subtitle': { fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: '0.15rem' },
		'.dp-subtitle:empty': { display: 'none' },
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
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: '0.3rem',
			borderBottom: '1px solid var(--border-soft)',
			paddingBottom: '0.4rem'
		},
		'.dp-day-head-l': { display: 'flex', alignItems: 'baseline', gap: '0.4rem', minWidth: '0' },
		'.dp-day-wd': {
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '700',
			textTransform: 'uppercase',
			letterSpacing: 'var(--tracking-eyebrow)',
			color: 'var(--muted)'
		},
		'.dp-day.today .dp-day-wd': { color: 'var(--brand-accent)' },
		'.dp-day-num': { fontSize: 'var(--fs-title)', fontWeight: '700', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: '1' },
		'.dp-day.today .dp-day-num': { color: 'var(--brand-accent)' },
		'.dp-day-count': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', flexShrink: '0' },
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

// Shared JS prelude (weekday parsing, role colour, time helpers, ISO week) for both vibes.
const PRELUDE = `
var WD_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
var WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
var MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function pad(n) { return (n < 10 ? '0' : '') + n }

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
	for (var i = 0; i < table.length; i++) if (s.indexOf(table[i][0]) === 0) return table[i][1]
	var d = new Date(day)
	if (!isNaN(d.getTime())) return (d.getDay() + 6) % 7
	return null
}

function roleKind(role) {
	var s = String(role || '').toLowerCase()
	if (s.indexOf('koch') !== -1 || s.indexOf('köch') !== -1 || s.indexOf('cook') !== -1 || s.indexOf('küche') !== -1 || s.indexOf('chef') !== -1) return 'cook'
	if (s.indexOf('kellner') !== -1 || s.indexOf('service') !== -1 || s.indexOf('waiter') !== -1 || s.indexOf('servier') !== -1) return 'service'
	if (s.indexOf('bar') !== -1 || s.indexOf('theke') !== -1) return 'bar'
	return 'other'
}

function startMinutes(t) {
	var m = String(t || '').match(/(BSBSd{1,2}):(BSBSd{2})/)
	if (!m) return 9999
	return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function timeLabel(s) {
	var a = String(s.start || '').trim()
	var b = String(s.end || '').trim()
	if (a && b) return a + '–' + b
	return a || b || ''
}

// ISO 8601 calendar week of a date.
function isoWeek(d) {
	var t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
	var day = (t.getDay() + 6) % 7
	t.setDate(t.getDate() - day + 3)
	var firstThu = new Date(t.getFullYear(), 0, 4)
	var fd = (firstThu.getDay() + 6) % 7
	firstThu.setDate(firstThu.getDate() - fd + 3)
	return 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000))
}
`.replace(/BSBS/g, '\\\\')

const DIENSTPLAN_LOGIC = `${PRELUDE}
function initState(source) {
	source = source || {}
	var items = source.items || []
	var weekOffset = parseInt(source.weekOffset || 0, 10) || 0
	var now = new Date()
	var todayIdx = (now.getDay() + 6) % 7
	// Monday of the target week
	var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx + weekOffset * 7)

	var days = []
	for (var i = 0; i < 7; i++) {
		var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
		days.push({
			wd: WD_SHORT[i],
			dnum: String(d.getDate()),
			dayClass: 'dp-day' + (weekOffset === 0 && i === todayIdx ? ' today' : ''),
			count: '',
			shifts: []
		})
	}

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
		planned++
	}
	for (var g = 0; g < 7; g++) {
		days[g].shifts.sort(function (a, b) { return a._m - b._m })
		days[g].count = days[g].shifts.length ? String(days[g].shifts.length) : ''
	}

	var sun = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
	var range = monday.getDate() + '. ' + MONTHS[monday.getMonth()] + ' – ' + sun.getDate() + '. ' + MONTHS[sun.getMonth()]
	var rel = weekOffset === 0 ? 'Diese Woche' : weekOffset === 1 ? 'Nächste Woche' : weekOffset === -1 ? 'Letzte Woche' : (weekOffset > 0 ? 'In ' + weekOffset + ' Wochen' : 'Vor ' + (-weekOffset) + ' Wochen')

	return {
		eyebrow: 'Dienstplan · KW ' + isoWeek(monday),
		title: rel,
		subtitle: range,
		statLabel: 'Schichten',
		statValue: String(planned),
		days: days,
		isEmpty: planned === 0,
		emptyMessage: planned === 0 ? 'Noch keine Schichten geplant — sag z. B. „Anna am Montag 17 bis 23 Uhr als Köchin".' : ''
	}
}
function handleEvent(type, payload, state) { return state }
`

// ── the PER-PERSON list vibe ─────────────────────────────────────────────────
const LIST_VIEW = {
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
				class: 'dp-card dp-card--people',
				children: [
					{ text: '$emptyMessage', class: 'dp-empty' },
					{
						$each: {
							items: '$people',
							template: {
								class: 'dpl-person',
								children: [
									{
										class: 'dpl-person-head',
										children: [
											{ text: '$$name', class: 'dpl-name' },
											{ text: '$$count', class: 'dpl-count' }
										]
									},
									{
										$each: {
											items: '$$shifts',
											template: {
												class: '$$rowClass',
												children: [
													{ text: '$$day', class: 'dpl-day' },
													{ text: '$$time', class: 'dpl-time' },
													{ text: '$$role', class: 'dpl-role' }
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
}

const LIST_STYLE = {
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
		'.dp-card--people': { display: 'flex', flexDirection: 'column', gap: '0.9rem' },
		'.dp-empty': { padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' },
		'.dp-empty:empty': { display: 'none' },
		'.dpl-person': { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
		'.dpl-person-head': {
			display: 'flex',
			alignItems: 'baseline',
			justifyContent: 'space-between',
			gap: '0.5rem',
			borderBottom: '1px solid var(--border-soft)',
			paddingBottom: '0.35rem',
			marginBottom: '0.15rem'
		},
		'.dpl-name': { fontSize: 'var(--fs-section)', fontWeight: '700' },
		'.dpl-count': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-eyebrow)' },
		'.dpl-row': {
			display: 'flex',
			alignItems: 'center',
			gap: '0.8rem',
			padding: '0.4rem 0.2rem 0.4rem 0.7rem',
			borderLeft: '3px solid var(--role-other)',
			borderRadius: 'var(--radius-inner)',
			background: 'var(--surface-2)'
		},
		'.dpl-row.cook': { borderLeft: '3px solid var(--role-cook)' },
		'.dpl-row.service': { borderLeft: '3px solid var(--role-service)' },
		'.dpl-row.bar': { borderLeft: '3px solid var(--role-bar)' },
		'.dpl-day': { fontSize: 'var(--fs-label)', fontWeight: '600', minWidth: '2.4rem', flexShrink: '0' },
		'.dpl-time': { fontSize: 'var(--fs-label)', color: 'var(--muted-strong)', fontVariantNumeric: 'tabular-nums', flex: '1', minWidth: '0' },
		'.dpl-role': { fontSize: 'var(--fs-micro)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-eyebrow)', color: 'var(--role-other)', flexShrink: '0' },
		'.dpl-row.cook .dpl-role': { color: 'var(--role-cook)' },
		'.dpl-row.service .dpl-role': { color: 'var(--role-service)' },
		'.dpl-row.bar .dpl-role': { color: 'var(--role-bar)' }
	}
}

const LIST_LOGIC = `${PRELUDE}
function initState(source) {
	source = source || {}
	var items = source.items || []
	var groups = {}
	var order = []
	for (var k = 0; k < items.length; k++) {
		var it = items[k] || {}
		var person = String(it.person || it.name || '—')
		if (!groups[person]) { groups[person] = []; order.push(person) }
		var idx = dayIndex(it.day)
		groups[person].push({
			day: idx === null ? String(it.day || '—') : WD_SHORT[idx],
			time: timeLabel(it),
			role: String(it.role || ''),
			rowClass: 'dpl-row ' + roleKind(it.role),
			_d: idx === null ? 9 : idx,
			_m: startMinutes(it.start)
		})
	}
	order.sort()
	var people = []
	for (var i = 0; i < order.length; i++) {
		var name = order[i]
		var list = groups[name]
		list.sort(function (a, b) { return a._d - b._d || a._m - b._m })
		people.push({ name: name, count: list.length + (list.length === 1 ? ' Schicht' : ' Schichten'), shifts: list })
	}
	return {
		eyebrow: 'Dienstplan',
		title: 'Schichten je Person',
		statLabel: 'Personen',
		statValue: String(people.length),
		people: people,
		isEmpty: people.length === 0,
		emptyMessage: people.length === 0 ? 'Noch keine Schichten geplant.' : ''
	}
}
function handleEvent(type, payload, state) { return state }
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
		// grid (updated: dates + KW + weekOffset)
		await upsertJson(db, 'vibe_view', 'dienstplan', DIENSTPLAN_VIEW)
		await upsertJson(db, 'vibe_style', 'dienstplan', DIENSTPLAN_STYLE)
		await upsertLogic(db, 'dienstplan', DIENSTPLAN_LOGIC)
		// per-person list
		await upsertJson(db, 'vibe_view', 'dienstplan-list', LIST_VIEW)
		await upsertJson(db, 'vibe_style', 'dienstplan-list', LIST_STYLE)
		await upsertLogic(db, 'dienstplan-list', LIST_LOGIC)
		// show_dienstplan gains the optional `week` argument
		await sql`
			UPDATE actor SET mailbox = ${JSON.stringify(SHOW_MAILBOX)}::jsonb, updated_at = now()
			WHERE id = ${SHOW_ACTOR_ID}
		`.execute(db)
	} catch (e) {
		console.error('[migrate 0119] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'dienstplan-list'`.execute(db)
}
