import { type Kysely, sql } from 'kysely'

// board aven-voice/dienstplan — DATED assignments + role-colour sort.
//  1. A slot TEMPLATE stays weekday-based (recurring every week). But an ASSIGNMENT (shift) is now tied
//     to a concrete DATE: assign_shift resolves each weekday to the target week's real date and writes
//     shift.day = "2026-07-13". So putting Anna on Monday fills THIS Monday only — next week's Monday is
//     open again (no silent weekly repeat). Legacy weekday-only shifts still match (recurring) for back-
//     compat, so nothing already entered disappears.
//  2. Within a day, blocks sort by ROLE COLOUR (cook → service → bar → other), then by start time — so
//     Koch and Küchenhilfe (both amber) sit together, Service (blue) together.

const ASSIGN_ACTOR_ID = '00000000-0000-0000-0000-0000000120d3'

const ASSIGN_MAILBOX = {
	description:
		'Assign a PERSON to one or more weekdays by filling the OPEN slot templates on those days — the ' +
		'person inherits each slot\'s role + start + end automatically. The assignment is DATED to the ' +
		'chosen week, so it does NOT repeat automatically. Optional `week`: 0 = this week (default), 1 = ' +
		'next week, -1 = last. Optional `role` restricts to slots of that role. Skips already-filled slots. ' +
		'e.g. "Anna am Montag, Dienstag, Samstag" → assign_shift(person:"Anna", days:["Montag","Dienstag","Samstag"]).',
	parameters: {
		type: 'object',
		properties: {
			person: { type: 'string', description: 'Who to assign (their name).' },
			days: { type: 'array', items: { type: 'string' }, description: 'Weekdays to fill, e.g. ["Montag","Samstag"].' },
			week: { type: 'integer', description: 'Week offset: 0 (default) this week, 1 next, -1 last.' },
			role: { type: 'string', description: 'Optional: only fill slots of this role (Koch/Service/…).' }
		},
		required: ['person', 'days']
	}
}

// Sandbox contract (board 0117): caps.ops() is SYNCHRONOUS — never await. Date IS available.
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
		for (var j = 0; j < slots.length; j++) {
			var sl = slots[j]
			if (didx(sl.day) !== wi) continue
			if (wantRole && String(sl.role || '').toLowerCase().indexOf(wantRole) === -1) continue
			// already filled? a shift on this exact date (or a legacy weekday shift) with same role+start.
			var filled = false
			for (var k = 0; k < shifts.length; k++) {
				var sh = shifts[k]
				var sameCol = isDate(sh.day) ? (sh.day === iso) : (didx(sh.day) === wi)
				if (sameCol && String(sh.role||'') === String(sl.role||'') && String(sh.start||'') === String(sl.start||'')) { filled = true; break }
			}
			if (filled) continue
			caps.ops('shift.create', { person: person, role: sl.role, day: iso, start: sl.start, end: sl.end })
			assigned.push({ date: iso, role: sl.role, start: sl.start, end: sl.end })
			shifts.push({ person: person, role: sl.role, day: iso, start: sl.start, end: sl.end })
		}
	}
	var freshShifts = (caps.ops('shift.list', {}).rows) || []
	return { slots: slots, shifts: freshShifts, assigned: assigned, person: person, week: week, ok: true }
}
`

// ── grid: date-based matching + role-colour sort ─────────────────────────────
const PRELUDE = `
var WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
var MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
function pad(n) { return (n < 10 ? '0' : '') + n }
function dayIndex(day) {
	var s = String(day || '').trim().toLowerCase()
	if (!s) return null
	var t = [['montag',0],['monday',0],['mon',0],['mo',0],['dienstag',1],['tuesday',1],['tue',1],['di',1],['mittwoch',2],['wednesday',2],['wed',2],['mi',2],['donnerstag',3],['thursday',3],['thu',3],['do',3],['freitag',4],['friday',4],['fri',4],['fr',4],['sonnabend',5],['samstag',5],['saturday',5],['sat',5],['sa',5],['sonntag',6],['sunday',6],['sun',6],['so',6]]
	for (var i=0;i<t.length;i++) if (s.indexOf(t[i][0])===0) return t[i][1]
	var d = new Date(day); if (!isNaN(d.getTime())) return (d.getDay()+6)%7
	return null
}
function isDate(v) { return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(String(v || '')) }
function roleKind(role) {
	var s = String(role || '').toLowerCase()
	if (s.indexOf('koch')!==-1||s.indexOf('köch')!==-1||s.indexOf('cook')!==-1||s.indexOf('küche')!==-1||s.indexOf('chef')!==-1) return 'cook'
	if (s.indexOf('kellner')!==-1||s.indexOf('service')!==-1||s.indexOf('waiter')!==-1||s.indexOf('servier')!==-1) return 'service'
	if (s.indexOf('bar')!==-1||s.indexOf('theke')!==-1) return 'bar'
	return 'other'
}
function kindRank(role) { var k = roleKind(role); return k==='cook'?0:k==='service'?1:k==='bar'?2:3 }
function startMinutes(t) { var m=String(t||'').match(/([0-9]{1,2}):([0-9]{2})/); return m ? parseInt(m[1],10)*60+parseInt(m[2],10) : 9999 }
function timeLabel(s) { var a=String(s.start||'').trim(), b=String(s.end||'').trim(); return a&&b ? a+'–'+b : (a||b||'') }
function isoWeek(d) { var t=new Date(d.getFullYear(),d.getMonth(),d.getDate()); var day=(t.getDay()+6)%7; t.setDate(t.getDate()-day+3); var f=new Date(t.getFullYear(),0,4); var fd=(f.getDay()+6)%7; f.setDate(f.getDate()-fd+3); return 1+Math.round((t.getTime()-f.getTime())/(7*86400000)) }
`

const DIENSTPLAN_LOGIC = `${PRELUDE}
function initState(source) {
	source = source || {}
	var slots = source.slots || []
	var shifts = source.shifts || source.items || []
	var weekOffset = parseInt(source.weekOffset || 0, 10) || 0
	var now = new Date()
	var todayIdx = (now.getDay() + 6) % 7
	var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx + weekOffset * 7)

	var days = []
	for (var i = 0; i < 7; i++) {
		var dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
		var iso = dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate())
		days.push({ wd: WD_SHORT[i], dnum: String(dt.getDate()), iso: iso, dayClass: 'dp-day' + (weekOffset === 0 && i === todayIdx ? ' today' : ''), count: '', shifts: [] })
	}

	// a shift belongs to column i (date ISO) if it is DATED to that date, or (legacy) names that weekday.
	function inColumn(sh, i, iso) { return isDate(sh.day) ? (String(sh.day).slice(0,10) === iso) : (dayIndex(sh.day) === i) }

	var filled = 0, open = 0
	for (var d = 0; d < 7; d++) {
		var iso2 = days[d].iso
		var daySlots = [], dayShifts = []
		for (var s = 0; s < slots.length; s++) if (dayIndex(slots[s].day) === d) daySlots.push(slots[s])
		for (var h = 0; h < shifts.length; h++) if (inColumn(shifts[h], d, iso2)) dayShifts.push(shifts[h])
		var used = {}
		for (var j = 0; j < daySlots.length; j++) {
			var sl = daySlots[j]
			var match = null
			for (var k = 0; k < dayShifts.length; k++) {
				var sh = dayShifts[k]
				if (!used[k] && String(sh.role||'') === String(sl.role||'') && String(sh.start||'') === String(sl.start||'')) { match = sh; used[k] = true; break }
			}
			var kind = roleKind(sl.role)
			if (match) { filled++; days[d].shifts.push({ person: String(match.person || '—'), role: String(sl.role||''), time: timeLabel(sl), shiftClass: 'dp-shift ' + kind, _r: kindRank(sl.role), _m: startMinutes(sl.start) }) }
			else { open++; days[d].shifts.push({ person: 'offen', role: String(sl.role||''), time: timeLabel(sl), shiftClass: 'dp-shift open ' + kind, _r: kindRank(sl.role), _m: startMinutes(sl.start) }) }
		}
		for (var m2 = 0; m2 < dayShifts.length; m2++) {
			if (used[m2]) continue
			var ex = dayShifts[m2]; filled++
			days[d].shifts.push({ person: String(ex.person || '—'), role: String(ex.role||''), time: timeLabel(ex), shiftClass: 'dp-shift ' + roleKind(ex.role), _r: kindRank(ex.role), _m: startMinutes(ex.start) })
		}
		// sort by role COLOUR (cook→service→bar→other), then start time — same colours cluster.
		days[d].shifts.sort(function (a, b) { return a._r - b._r || a._m - b._m })
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

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		await sql`UPDATE actor SET code = ${ASSIGN_CODE}, mailbox = ${JSON.stringify(ASSIGN_MAILBOX)}::jsonb, updated_at = now() WHERE id = ${ASSIGN_ACTOR_ID}`.execute(db)
		await sql`INSERT INTO vibe_logic (name, body) VALUES ('dienstplan', ${DIENSTPLAN_LOGIC})
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	} catch (e) {
		console.error('[migrate 0121] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only tweak to existing rows; nothing to drop.
}
