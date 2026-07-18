import { randomUUID } from 'node:crypto'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board aven-voice — WIRE people (prenu) into todos + the roster.
//  • todos gain an `assignee` field REIFIED to prenu (member_of→goal pattern): writing a name find-or-
//    creates the contact and stores its id; the flat view reads the name back (refName). Clean edge
//    reification — a new optional field, no existing-data migration.
//  • assign_shift now find-or-creates the assigned person in the addressbook (caps ops:prenu), so every
//    rostered person shows up under Kontakte. (shift.person stays a string — its worker predicate is the
//    PRIMARY, and refName only projects off edges, so a full id-reify would need a schema restructure.)

const ASSIGN_ACTOR_ID = '00000000-0000-0000-0000-0000000120d3'

const ASSIGNED_TO: PredicateDef = {
	predicate: 'assigned_to',
	gismu: 'gunka',
	gloss: 'gunka: x1 (a task) is worked/handled by person x2 — the todo\'s assignee (a prenu entity)',
	places: [
		{ pos: 'x1', role: 'task', gloss: 'the task row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'assignee', gloss: 'the person (prenu) it is assigned to — symbolic id = the contact', kind: 'ref', references: '*' }
	]
}

// assign_shift + prenu find-or-create (adds to 0123: no double-booking, dated, weekOffset).
const ASSIGN_CODE = `
function handle(msg, caps) {
	function pad(n) { return (n < 10 ? '0' : '') + n }
	function didx(day) {
		var s = String(day || '').trim().toLowerCase()
		if (!s) return null
		var t = [['montag',0],['monday',0],['mon',0],['mo',0],['dienstag',1],['tuesday',1],['tue',1],['di',1],['mittwoch',2],['wednesday',2],['wed',2],['mi',2],['donnerstag',3],['thursday',3],['thu',3],['do',3],['freitag',4],['friday',4],['fri',4],['fr',4],['sonnabend',5],['samstag',5],['saturday',5],['sat',5],['sa',5],['sonntag',6],['sunday',6],['sun',6],['so',6]]
		for (var i=0;i<t.length;i++) if (s.indexOf(t[i][0])===0) return t[i][1]
		var d = new Date(day); if (!isNaN(d.getTime())) return (d.getDay()+6)%7
		return null
	}
	function isDate(v) { return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(String(v || '')) }
	var person = String((msg && msg.person) || '').trim()
	var days = (msg && msg.days) || []
	if (typeof days === 'string') days = [days]
	var wantRole = String((msg && msg.role) || '').trim().toLowerCase()
	var week = parseInt((msg && msg.week) || 0, 10) || 0

	var now = new Date()
	var ti = (now.getDay() + 6) % 7
	var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ti + week * 7)
	function isoFor(wi) { var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + wi); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) }

	var slots = (caps.ops('slot.list', {}).rows) || []
	var shifts = (caps.ops('shift.list', {}).rows) || []
	var assigned = []
	var skipped = []
	for (var di = 0; di < days.length; di++) {
		var wi = didx(days[di])
		if (wi === null) continue
		var iso = isoFor(wi)
		var pool = []
		var alreadyHere = false
		for (var k = 0; k < shifts.length; k++) {
			var sh = shifts[k]
			var sameCol = isDate(sh.day) ? (String(sh.day).slice(0,10) === iso) : (didx(sh.day) === wi)
			if (sameCol) {
				pool.push({ role: String(sh.role||''), start: String(sh.start||''), used: false })
				if (String(sh.person||'').toLowerCase() === person.toLowerCase()) alreadyHere = true
			}
		}
		if (alreadyHere) { skipped.push({ date: iso, reason: 'already-assigned' }); continue }
		var target = null
		for (var j = 0; j < slots.length; j++) {
			var sl = slots[j]
			if (didx(sl.day) !== wi) continue
			if (wantRole && String(sl.role || '').toLowerCase().indexOf(wantRole) === -1) continue
			var consumed = false
			for (var p = 0; p < pool.length; p++) {
				if (!pool[p].used && pool[p].role === String(sl.role||'') && pool[p].start === String(sl.start||'')) { pool[p].used = true; consumed = true; break }
			}
			if (!consumed && !target) target = sl
		}
		if (target) {
			caps.ops('shift.create', { person: person, role: target.role, day: iso, start: target.start, end: target.end })
			assigned.push({ date: iso, role: target.role, start: target.start, end: target.end })
			shifts.push({ person: person, role: target.role, day: iso, start: target.start, end: target.end })
		} else {
			skipped.push({ date: iso, reason: 'no-open-slot' })
		}
	}

	// wire into the addressbook: make sure the assigned person exists as a contact (find-or-create).
	if (person && assigned.length) {
		var contacts = (caps.ops('prenu.list', {}).rows) || []
		var found = false
		for (var c = 0; c < contacts.length; c++) if (String(contacts[c].name||'').toLowerCase() === person.toLowerCase()) { found = true; break }
		if (!found) caps.ops('prenu.create', { name: person })
	}

	var freshShifts = (caps.ops('shift.list', {}).rows) || []
	return { slots: slots, shifts: freshShifts, weekOffset: week, assigned: assigned, skipped: skipped, person: person, ok: true, filled: assigned.length }
}
`

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		// 1. assigned_to predicate per user.
		const users = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL`.execute(db)
		const body = JSON.stringify(compilePredicate(ASSIGNED_TO))
		for (const { user_id } of users.rows) {
			const ex = await sql<{ id: string }>`SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = 'assigned_to' LIMIT 1`.execute(db)
			if (ex.rows[0]) await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${ex.rows[0].id}`.execute(db)
			else await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at) VALUES (${randomUUID()}, ${user_id}, 'assigned_to', ${body}::jsonb, now(), now())`.execute(db)
		}

		// 2. patch the todos bundle: add the reified assignee edge → prenu, then re-derive its ops.
		const row = await sql<{ spec: unknown }>`SELECT spec FROM data_bundles WHERE type = 'todos'`.execute(db)
		if (row.rows[0]) {
			const spec = (typeof row.rows[0].spec === 'string' ? JSON.parse(row.rows[0].spec) : row.rows[0].spec) as {
				parts: { pred: string }[]
				project: Record<string, unknown>
			}
			if (!spec.parts.some((p) => p.pred === 'assigned_to')) {
				spec.parts.push({
					pred: 'assigned_to',
					kind: 'replace',
					link: 'x1',
					field: 'assignee',
					set: { x1: '$primary', x2: '$value' },
					refType: 'prenu'
				} as never)
			}
			spec.project.assignee = { pred: 'assigned_to', place: 'x2', refName: true }
			await saveType(spec as never)
		}

		// 3. assign_shift: find-or-create the assigned person in the addressbook (needs ops:prenu).
		await sql`UPDATE actor SET code = ${ASSIGN_CODE}, caps = ${JSON.stringify(['ops:slot', 'ops:shift', 'ops:prenu'])}::jsonb, updated_at = now() WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
	} catch (e) {
		console.error('[migrate 0125] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only wiring; the assignee field + prenu links stay.
}
