import { type Kysely, sql } from 'kysely'

// board aven-voice/dienstplan — fix: fill the SECOND (and further) identical slot.
// A day can have several IDENTICAL slots (e.g. 2× Service 16:45–22:45). The old assign_shift only
// asked "does ANY shift match this slot's role+start?" — so one Anna made BOTH service slots look
// filled, and the open second slot could never be staffed. Now existing shifts are consumed ONE-TO-ONE
// against the slots; the first slot with no unconsumed matching shift is the OPEN one and gets filled.
// assign_shift fills ONE open slot per day (matching the optional role) — one person, one shift per day.

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

	var now = new Date()
	var ti = (now.getDay() + 6) % 7
	var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ti + week * 7)
	function isoFor(wi) { var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + wi); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) }

	var slots = (caps.ops('slot.list', {}).rows) || []
	var shifts = (caps.ops('shift.list', {}).rows) || []
	var assigned = []
	for (var di = 0; di < days.length; di++) {
		var wi = didx(days[di])
		if (wi === null) continue
		var iso = isoFor(wi)

		// existing shifts on this column (dated to iso, or legacy weekday) — each can occupy ONE slot.
		var pool = []
		for (var k = 0; k < shifts.length; k++) {
			var sh = shifts[k]
			var sameCol = isDate(sh.day) ? (String(sh.day).slice(0,10) === iso) : (didx(sh.day) === wi)
			if (sameCol) pool.push({ role: String(sh.role||''), start: String(sh.start||''), used: false })
		}

		// walk this weekday's slots (role filter); consume a matching shift per slot; first UNconsumed = open.
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
		}
	}
	var freshShifts = (caps.ops('shift.list', {}).rows) || []
	return { slots: slots, shifts: freshShifts, assigned: assigned, person: person, week: week, ok: true, filled: assigned.length }
}
`

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		await sql`UPDATE actor SET code = ${ASSIGN_CODE}, updated_at = now() WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
	} catch (e) {
		console.error('[migrate 0122] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only tweak to the actor code; nothing to drop.
}
