import { type Kysely, sql } from 'kysely'

// board aven-voice — assign_shift must write the prenu ID (not the name) now that shift.person is a
// reified staffed_by → prenu edge. The actor calls caps.ops('shift.create') = runNamedOp, which does
// NOT run the crud resolveRefs layer, so a raw name would land in staffed_by.x2 and refName (name join)
// would find nothing. Fix: find-or-create the prenu ONCE up front, pass its id to shift.create.
// Double-booking / pool comparisons still use the NAME (shift.list projects the name via refName).

const ASSIGN_ACTOR_ID = '00000000-0000-0000-0000-0000000120d3'

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

	// resolve the person to a prenu ID up front (find-or-create) — shift.create stores the ID.
	var prenuId = null
	if (person) {
		var contacts = (caps.ops('prenu.list', {}).rows) || []
		for (var c = 0; c < contacts.length; c++) if (String(contacts[c].name||'').toLowerCase() === person.toLowerCase()) { prenuId = contacts[c].id; break }
		if (!prenuId) { var cr = caps.ops('prenu.create', { name: person }); prenuId = (cr && cr.ids && cr.ids[0]) || null }
	}
	var personRef = prenuId || person

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
			caps.ops('shift.create', { person: personRef, role: target.role, day: iso, start: target.start, end: target.end })
			assigned.push({ date: iso, role: target.role, start: target.start, end: target.end })
			// track by NAME so the same-day guard works within this run
			shifts.push({ person: person, role: target.role, day: iso, start: target.start, end: target.end })
		} else {
			skipped.push({ date: iso, reason: 'no-open-slot' })
		}
	}

	var freshShifts = (caps.ops('shift.list', {}).rows) || []
	return { slots: slots, shifts: freshShifts, weekOffset: week, assigned: assigned, skipped: skipped, person: person, ok: true, filled: assigned.length }
}
`

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		await sql`UPDATE actor SET code = ${ASSIGN_CODE}, updated_at = now() WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
	} catch (e) {
		console.error('[migrate 0127] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only tweak to the actor code.
}
