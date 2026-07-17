import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board aven-voice/dienstplan — SLOT TEMPLATES. A restaurant roster has fixed recurring POSITIONS to
// fill every week (a Koch slot Mo 13:00–22:30, 2× Service Fr 17:00–23:00 …). Slots start EMPTY; you fill
// them by assigning a person, who inherits the slot's role + times. Two schemas, cleanly separated:
//   `slot`  — the template/requirement (role + weekday + start/end). Set once, repeats weekly.
//   `shift` — a person's assignment (0118). `assign_shift` copies a slot's timing onto a new shift.
// Ontology: the slot anchor is a new `slot`≡stuzi (an inherent site/position); day/start/end REUSE the
// existing onday/starts/ends predicates (atomic + shared — a slot row and a shift row just differ by
// which primary id links them).

const DP_SLOT: PredicateDef = {
	predicate: 'slot',
	gismu: 'stuzi',
	gloss: 'stuzi: x1 is an inherent site/position (a roster slot); x2 = the role it must be filled with',
	places: [
		{ pos: 'x1', role: 'slot', gloss: 'the slot row (implicit)', kind: 'ref', references: '*', required: false },
		{ pos: 'x2', role: 'role', gloss: 'the role this slot needs (Koch/Kellner/Barkeeper …)', kind: 'value', type: 'string' }
	]
}

const SLOT_SPEC: TypeSpec = {
	type: 'slot',
	parts: [
		{ pred: 'slot', kind: 'primary', field: 'role', create: { x1: '$user', x2: '$value' }, set: { x2: '$value' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'onday', kind: 'replace', link: 'x1', field: 'day', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'starts', kind: 'replace', link: 'x1', field: 'start', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'ends', kind: 'replace', link: 'x1', field: 'end', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		role: { pred: 'slot', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' },
		day: { pred: 'onday', place: 'x2' },
		start: { pred: 'starts', place: 'x2' },
		end: { pred: 'ends', place: 'x2' }
	}
}

const CRUD_ACTOR_ID = '00000000-0000-0000-0000-0000000118d1'
const ASSIGN_ACTOR_ID = '00000000-0000-0000-0000-0000000120d3'

// data_crud now teaches BOTH schemas of this skill.
const CRUD_MAILBOX = {
	description:
		'Read or modify the roster. TWO schemas on this skill:\n' +
		'• "slot" = the recurring TEMPLATE positions to fill each week — role + day (Montag…Sonntag) + ' +
		'start + end, no person. Create these once ("Koch-Slot Mo 13:00–22:30", zweimal Service Fr 17–23).\n' +
		'• "shift" = a PERSON\'s assignment (person + role + day + start + end).\n' +
		'BATCH via `items`. update/delete need the row "id" — list first. To put a person on a day, prefer ' +
		'the `assign_shift` tool (it fills the open slots and copies their times) instead of crafting shifts by hand.',
	parameters: {
		type: 'object',
		properties: {
			schema: { type: 'string', description: 'Either "slot" (templates) or "shift" (assignments) on this skill.' },
			action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
			filter: {
				type: 'object',
				description: 'list only: {"field":<role|day|start|end|person>,"value":…}. e.g. {"field":"day","value":"Montag"}.',
				properties: { field: { type: 'string' }, value: {}, op: { type: 'string' } }
			},
			items: {
				type: 'array',
				description:
					'slot create: {"role":"Koch","day":"Montag","start":"13:00","end":"22:30"}. ' +
					'shift create: {"person":"Anna","role":"Koch","day":"Montag","start":"13:00","end":"22:30"}. ' +
					'update: same fields + the row "id".',
				items: { type: 'object', additionalProperties: true }
			},
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['schema', 'action']
	}
}

const ASSIGN_MAILBOX = {
	description:
		'Assign a PERSON to one or more weekdays by filling the OPEN slot templates on those days — the ' +
		'person inherits each slot\'s role + start + end automatically (no need to state times). ' +
		'e.g. "Anna am Montag, Dienstag und Samstag" → assign_shift(person:"Anna", days:["Montag","Dienstag","Samstag"]). ' +
		'Optional `role` restricts to slots of that role when a day has several. Skips slots already filled.',
	parameters: {
		type: 'object',
		properties: {
			person: { type: 'string', description: 'Who to assign (their name).' },
			days: { type: 'array', items: { type: 'string' }, description: 'Weekdays to fill, e.g. ["Montag","Samstag"].' },
			role: { type: 'string', description: 'Optional: only fill slots of this role (Koch/Service/…).' }
		},
		required: ['person', 'days']
	}
}

// The assign actor (sandboxed): read slots + shifts, create a shift per OPEN matching slot copying its
// times, return the fresh {slots, shifts} so the dienstplan grid re-renders with the filled slots.
// SANDBOX CONTRACT (board 0117): caps.ops() is SYNCHRONOUS here (asyncify blocks the VM during the
// main eval and returns the value directly) — NEVER use await; call caps.ops() straight, any number of
// times, in a plain synchronous handle.
const ASSIGN_CODE = `
function handle(msg, caps) {
	function didx(day) {
		var s = String(day || '').trim().toLowerCase()
		if (!s) return null
		var t = [['montag',0],['monday',0],['mon',0],['mo',0],['dienstag',1],['tuesday',1],['tue',1],['di',1],['mittwoch',2],['wednesday',2],['wed',2],['mi',2],['donnerstag',3],['thursday',3],['thu',3],['do',3],['freitag',4],['friday',4],['fri',4],['fr',4],['sonnabend',5],['samstag',5],['saturday',5],['sat',5],['sa',5],['sonntag',6],['sunday',6],['sun',6],['so',6]]
		for (var i=0;i<t.length;i++) if (s.indexOf(t[i][0])===0) return t[i][1]
		return null
	}
	var person = String((msg && msg.person) || '').trim()
	var days = (msg && msg.days) || []
	if (typeof days === 'string') days = [days]
	var wantRole = String((msg && msg.role) || '').trim().toLowerCase()

	var slotRes = caps.ops('slot.list', {}); var slots = (slotRes && slotRes.rows) || []
	var shiftRes = caps.ops('shift.list', {}); var shifts = (shiftRes && shiftRes.rows) || []
	var assigned = []
	for (var di = 0; di < days.length; di++) {
		var d = didx(days[di])
		if (d === null) continue
		for (var j = 0; j < slots.length; j++) {
			var sl = slots[j]
			if (didx(sl.day) !== d) continue
			if (wantRole && String(sl.role || '').toLowerCase().indexOf(wantRole) === -1) continue
			// is an equivalent slot already filled? (a shift with same day+role+start)
			var filled = false
			for (var k = 0; k < shifts.length; k++) {
				var sh = shifts[k]
				if (didx(sh.day) === d && String(sh.role||'') === String(sl.role||'') && String(sh.start||'') === String(sl.start||'')) { filled = true; break }
			}
			if (filled) continue
			caps.ops('shift.create', { person: person, role: sl.role, day: sl.day, start: sl.start, end: sl.end })
			assigned.push({ day: sl.day, role: sl.role, start: sl.start, end: sl.end })
			shifts.push({ person: person, role: sl.role, day: sl.day, start: sl.start, end: sl.end })
		}
	}
	var freshRes = caps.ops('shift.list', {}); var freshShifts = (freshRes && freshRes.rows) || []
	return { slots: slots, shifts: freshShifts, assigned: assigned, person: person, ok: true }
}
`

// ── the grid vibe: MERGE slots (structure) + shifts (assignments) → open / filled blocks ─────────────
const PRELUDE = `
var WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
var MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
function dayIndex(day) {
	var s = String(day || '').trim().toLowerCase()
	if (!s) return null
	var t = [['montag',0],['monday',0],['mon',0],['mo',0],['dienstag',1],['tuesday',1],['tue',1],['di',1],['mittwoch',2],['wednesday',2],['wed',2],['mi',2],['donnerstag',3],['thursday',3],['thu',3],['do',3],['freitag',4],['friday',4],['fri',4],['fr',4],['sonnabend',5],['samstag',5],['saturday',5],['sat',5],['sa',5],['sonntag',6],['sunday',6],['sun',6],['so',6]]
	for (var i=0;i<t.length;i++) if (s.indexOf(t[i][0])===0) return t[i][1]
	var d = new Date(day); if (!isNaN(d.getTime())) return (d.getDay()+6)%7
	return null
}
function roleKind(role) {
	var s = String(role || '').toLowerCase()
	if (s.indexOf('koch')!==-1||s.indexOf('köch')!==-1||s.indexOf('cook')!==-1||s.indexOf('küche')!==-1||s.indexOf('chef')!==-1) return 'cook'
	if (s.indexOf('kellner')!==-1||s.indexOf('service')!==-1||s.indexOf('waiter')!==-1||s.indexOf('servier')!==-1) return 'service'
	if (s.indexOf('bar')!==-1||s.indexOf('theke')!==-1) return 'bar'
	return 'other'
}
function startMinutes(t) { var m=String(t||'').match(/(BSBSd{1,2}):(BSBSd{2})/); return m ? parseInt(m[1],10)*60+parseInt(m[2],10) : 9999 }
function timeLabel(s) { var a=String(s.start||'').trim(), b=String(s.end||'').trim(); return a&&b ? a+'–'+b : (a||b||'') }
function isoWeek(d) { var t=new Date(d.getFullYear(),d.getMonth(),d.getDate()); var day=(t.getDay()+6)%7; t.setDate(t.getDate()-day+3); var f=new Date(t.getFullYear(),0,4); var fd=(f.getDay()+6)%7; f.setDate(f.getDate()-fd+3); return 1+Math.round((t.getTime()-f.getTime())/(7*86400000)) }
`.replace(/BSBS/g, '\\\\')

const DIENSTPLAN_LOGIC = `${PRELUDE}
function initState(source) {
	source = source || {}
	// Back-compat: if only "items" is given (a plain shift list), treat them as shifts.
	var slots = source.slots || []
	var shifts = source.shifts || source.items || []
	var weekOffset = parseInt(source.weekOffset || 0, 10) || 0
	var now = new Date()
	var todayIdx = (now.getDay() + 6) % 7
	var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx + weekOffset * 7)

	var days = []
	for (var i = 0; i < 7; i++) {
		var dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
		days.push({ wd: WD_SHORT[i], dnum: String(dt.getDate()), dayClass: 'dp-day' + (weekOffset === 0 && i === todayIdx ? ' today' : ''), count: '', shifts: [] })
	}

	var filled = 0, open = 0
	for (var d = 0; d < 7; d++) {
		var daySlots = [], dayShifts = []
		for (var s = 0; s < slots.length; s++) if (dayIndex(slots[s].day) === d) daySlots.push(slots[s])
		for (var h = 0; h < shifts.length; h++) if (dayIndex(shifts[h].day) === d) dayShifts.push(shifts[h])
		daySlots.sort(function (a, b) { return startMinutes(a.start) - startMinutes(b.start) })
		var used = {}
		for (var j = 0; j < daySlots.length; j++) {
			var sl = daySlots[j]
			var match = null
			for (var k = 0; k < dayShifts.length; k++) {
				var sh = dayShifts[k]
				if (!used[k] && String(sh.role||'') === String(sl.role||'') && String(sh.start||'') === String(sl.start||'')) { match = sh; used[k] = true; break }
			}
			var kind = roleKind(sl.role)
			if (match) { filled++; days[d].shifts.push({ person: String(match.person || '—'), role: String(sl.role||''), time: timeLabel(sl), shiftClass: 'dp-shift ' + kind, _m: startMinutes(sl.start) }) }
			else { open++; days[d].shifts.push({ person: 'offen', role: String(sl.role||''), time: timeLabel(sl), shiftClass: 'dp-shift open ' + kind, _m: startMinutes(sl.start) }) }
		}
		// shifts with no slot template (ad-hoc assignments) — still show them
		for (var m2 = 0; m2 < dayShifts.length; m2++) {
			if (used[m2]) continue
			var ex = dayShifts[m2]; filled++
			days[d].shifts.push({ person: String(ex.person || '—'), role: String(ex.role||''), time: timeLabel(ex), shiftClass: 'dp-shift ' + roleKind(ex.role), _m: startMinutes(ex.start) })
		}
		days[d].shifts.sort(function (a, b) { return a._m - b._m })
		days[d].count = days[d].shifts.length ? String(days[d].shifts.length) : ''
	}

	var sun = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
	var range = monday.getDate() + '. ' + MONTHS[monday.getMonth()] + ' – ' + sun.getDate() + '. ' + MONTHS[sun.getMonth()]
	var rel = weekOffset === 0 ? 'Diese Woche' : weekOffset === 1 ? 'Nächste Woche' : weekOffset === -1 ? 'Letzte Woche' : (weekOffset > 0 ? 'In ' + weekOffset + ' Wochen' : 'Vor ' + (-weekOffset) + ' Wochen')
	var total = filled + open

	return {
		eyebrow: 'Dienstplan · KW ' + isoWeek(monday),
		title: rel,
		subtitle: range + (open > 0 ? '  ·  ' + open + ' offen' : ''),
		statLabel: 'Besetzt',
		statValue: filled + '/' + total,
		days: days,
		isEmpty: total === 0,
		emptyMessage: total === 0 ? 'Noch keine Slots — sag z. B. „Koch-Slot Montag 13 bis 22:30 Uhr" und dann „Timo am Montag".' : ''
	}
}
function handleEvent(type, payload, state) { return state }
`

const DIENSTPLAN_STYLE_EXTRA = {
	'.dp-shift.open': { background: 'transparent', border: '1px dashed var(--border-strong)', borderLeft: '3px dashed var(--role-other)', opacity: '0.85' },
	'.dp-shift.open.cook': { borderLeft: '3px dashed var(--role-cook)' },
	'.dp-shift.open.service': { borderLeft: '3px dashed var(--role-service)' },
	'.dp-shift.open.bar': { borderLeft: '3px dashed var(--role-bar)' },
	'.dp-shift.open .dp-shift-person': { color: 'var(--muted)', fontWeight: '400' }
}

async function runUp(db: Kysely<unknown>): Promise<void> {
	// (helpers inline to keep the migration self-contained)
	const upsertLogic = async (name: string, body: string) =>
		sql`INSERT INTO vibe_logic (name, body) VALUES (${name}, ${body})
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)

	// 1. slot vocab for every existing user (day/start/end predicates already exist from 0118).
	const users = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL`.execute(db)
	const body = JSON.stringify(compilePredicate(DP_SLOT))
	for (const { user_id } of users.rows) {
		const existing = await sql<{ id: string }>`SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = 'slot' LIMIT 1`.execute(db)
		if (existing.rows[0]) await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(db)
		else await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at) VALUES (${randomUUID()}, ${user_id}, 'slot', ${body}::jsonb, now(), now())`.execute(db)
	}

	// 2. the slot bundle (derives slot.list/create/update/delete).
	await saveType(SLOT_SPEC)

	// 3. data_crud mailbox now teaches both schemas; add the assign_shift actor.
	await sql`UPDATE actor SET mailbox = ${JSON.stringify(CRUD_MAILBOX)}::jsonb, updated_at = now() WHERE id = ${CRUD_ACTOR_ID}`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, code, caps, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${ASSIGN_ACTOR_ID}, 'dienstplan', 'assign_shift', ${ASSIGN_CODE}, ${JSON.stringify(['ops:slot', 'ops:shift'])}::jsonb, ${JSON.stringify(ASSIGN_MAILBOX)}::jsonb, 'dienstplan', false, 2, now(), now())
		ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, caps = EXCLUDED.caps, mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
	`.execute(db)

	// 4. the grid vibe: merge slots + shifts; add the open-slot style.
	await upsertLogic('dienstplan', DIENSTPLAN_LOGIC)
	const styleRow = await sql<{ body: unknown }>`SELECT body FROM vibe_style WHERE name = 'dienstplan'`.execute(db)
	const style = (typeof styleRow.rows[0]?.body === 'string' ? JSON.parse(styleRow.rows[0].body as string) : styleRow.rows[0]?.body) as
		| { selectors?: Record<string, unknown> }
		| undefined
	if (style?.selectors) {
		style.selectors = { ...style.selectors, ...DIENSTPLAN_STYLE_EXTRA }
		await sql`UPDATE vibe_style SET body = ${JSON.stringify(style)}::jsonb, updated_at = now() WHERE name = 'dienstplan'`.execute(db)
	}
}

async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
	await sql`DELETE FROM data_operations WHERE derived_from = 'slot'`.execute(db)
	await sql`DELETE FROM data_bundles WHERE type = 'slot'`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		await runUp(db)
	} catch (e) {
		console.error('[migrate 0120] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export { down }
