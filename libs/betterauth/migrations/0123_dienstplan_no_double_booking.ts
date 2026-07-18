import { type Kysely, sql } from 'kysely'

// board aven-voice/dienstplan — a person can't work two slots the same day.
// assign_shift now SKIPS a day if the person already has a shift on that date (in any slot), so
// "Emma the whole week as second service" can't drop Emma into both service slots of one day. Also
// returns weekOffset so the grid stays on the week that was planned (voice-tools tracks the viewed week).

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
	var skipped = []
	for (var di = 0; di < days.length; di++) {
		var wi = didx(days[di])
		if (wi === null) continue
		var iso = isoFor(wi)

		// existing shifts on this column (dated to iso, or legacy weekday) — each can occupy ONE slot.
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
		// one person works at most ONE slot per day — never double-book them.
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
	var freshShifts = (caps.ops('shift.list', {}).rows) || []
	// weekOffset keeps the grid on the planned week after this edit.
	return { slots: slots, shifts: freshShifts, weekOffset: week, assigned: assigned, skipped: skipped, person: person, ok: true, filled: assigned.length }
}
`

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		await sql`UPDATE actor SET code = ${ASSIGN_CODE}, updated_at = now() WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
	} catch (e) {
		console.error('[migrate 0123] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only tweak to the actor code; nothing to drop.
}
