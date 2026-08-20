/**
 * The todo behaviour, as DATA — a QuickJS program, not host code.
 *
 * Voice tools and UI clicks both end here: the actor maps either into the
 * same events and calls `reduce`, so the two paths are byte-identical by
 * construction (the parity the 0130 goal asserts). IDs are a deterministic
 * counter (`w1`, `w2`, …) — same events in, same state out, every time.
 *
 * The STATE MACHINE is not hardcoded here: `composeTodoProgram(machine)`
 * prepends the states, the legal status moves, and the board cycle order
 * from `todo-machine.pl` as data (STATES / STATUS_MOVES / CYCLE), and the
 * reducer gates every transition against them — the SAME `.pl` that draws
 * the Skills canvas. Flow-as-data beside behaviour-as-data, one VM.
 *
 * `shape` is the only place raw model text becomes operations: it parses,
 * validates, and applies through the SAME transitions as reduce; anything
 * malformed returns null and the host state stays untouched.
 *
 * Kept as an exported string (not a .js?raw import) so bun tests and vite
 * load it the same way.
 */
import type { Machine } from '../../machine'

/** The machine, injected as a data prelude in front of the behaviour. */
export function composeTodoProgram(machine: Machine): string {
	const prelude =
		`var STATES = ${JSON.stringify(machine.states)}\n` +
		`var STATUS_MOVES = ${JSON.stringify(machine.statusMoves())}\n` +
		`var CYCLE = ${JSON.stringify(machine.cycles)}\n`
	return prelude + todoLogic
}

export const todoLogic = `
var SPARKS = [
	{ id: 'me', name: 'Me' },
	{ id: 'team', name: 'Team' }
]
var STATUS_LABEL = { open: 'Open', doing: 'In Progress', done: 'Done' }
var WIRE_LABEL = { open: 'open', doing: 'in progress', done: 'done' }
var WIRE_STATUS = { open: 'open', in_progress: 'doing', done: 'done' }

/** May a task move directly between these two statuses? (from the .pl) */
function legalStatus(from, to) {
	if (from === to) return true
	for (var i = 0; i < STATUS_MOVES.length; i++)
		if (STATUS_MOVES[i].from === from && STATUS_MOVES[i].to === to) return true
	return false
}

/** The board button's next status after this one — the .pl cycle order. */
function nextStatus(from) {
	for (var i = 0; i < CYCLE.length; i++) if (CYCLE[i].from === from) return CYCLE[i].to
	return from
}

/** One task, spoken — the wire format the model reads ids from. */
function line(item) {
	var meta = metaLabel(item)
	return (
		item.id + ' ' + item.title + ' (' + WIRE_LABEL[item.status] + ', ' + item.spark +
		(meta !== '' ? ', ' + meta : '') + ')'
	)
}

function lines(items) {
	var out = []
	for (var i = 0; i < items.length; i++) out.push(line(items[i]))
	return out.join('; ')
}

function listSaid(items) {
	return items.length === 0 ? 'list: empty' : 'list (' + items.length + '): ' + lines(items)
}

/** A full outcome: the next state plus what the sandbox SAYS about it. */
function speak(domain, said, record) {
	return { state: present(domain), said: said, record: record }
}

function isSpark(id) {
	for (var i = 0; i < SPARKS.length; i++) if (SPARKS[i].id === id) return true
	return false
}

function sparkName(id) {
	for (var i = 0; i < SPARKS.length; i++) if (SPARKS[i].id === id) return SPARKS[i].name
	return id
}

/** due as words: a single datetime or a range, whatever was given. */
function dueLabel(due) {
	if (!due) return ''
	if (typeof due === 'string') return due
	if (due.date) return String(due.date)
	if (due.start && due.end) return String(due.start) + ' → ' + String(due.end)
	if (due.start) return 'from ' + String(due.start)
	return ''
}

/** One quiet line under the title: #tags · due · @responsible. */
function metaLabel(item) {
	var parts = []
	var tags = item.tags || []
	for (var i = 0; i < tags.length; i++) parts.push('#' + tags[i])
	var due = dueLabel(item.due)
	if (due !== '') parts.push(due)
	if (item.responsible) parts.push('@' + item.responsible)
	return parts.join(' · ')
}

function row(item) {
	return {
		id: item.id,
		title: item.title,
		status: item.status,
		spark: item.spark,
		metaLabel: metaLabel(item),
		statusLabel: STATUS_LABEL[item.status],
		checked: item.status === 'done',
		rowClass: 'wi-row' + (item.status === 'done' ? ' wi-row--done' : ''),
		badgeClass: 'wi-badge wi-badge--' + item.status
	}
}

/** Derive everything a view renders from the domain fields. */
function present(domain) {
	var visible = []
	var i
	for (i = 0; i < domain.items.length; i++) {
		if (domain.items[i].spark === domain.active) visible.push(domain.items[i])
	}
	var rows = []
	for (i = 0; i < visible.length; i++) rows.push(row(visible[i]))
	var counts = { open: 0, doing: 0, done: 0, total: visible.length }
	for (i = 0; i < visible.length; i++) counts[visible[i].status]++
	var columns = []
	var statuses = STATES
	for (i = 0; i < statuses.length; i++) {
		var colRows = []
		for (var j = 0; j < rows.length; j++) {
			if (rows[j].status === statuses[i]) colRows.push(rows[j])
		}
		columns.push({
			status: statuses[i],
			label: STATUS_LABEL[statuses[i]],
			count: colRows.length,
			rows: colRows
		})
	}
	return {
		items: domain.items,
		active: domain.active,
		nextId: domain.nextId,
		rows: rows,
		columns: columns,
		counts: counts,
		progressPct: counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100),
		progressText: counts.done + ' of ' + counts.total + ' done',
		sparkName: sparkName(domain.active),
		empty: rows.length === 0
	}
}

/** Tags: an array of short strings, everything else dropped. */
function cleanTags(x) {
	if (Object.prototype.toString.call(x) !== '[object Array]') return []
	var out = []
	for (var i = 0; i < x.length; i++) if (typeof x[i] === 'string' && x[i] !== '') out.push(x[i])
	return out
}

/** Due: a datetime string, {date}, or {start,end} range — else nothing. */
function cleanDue(x) {
	if (typeof x === 'string' && x !== '') return x
	if (!x || typeof x !== 'object') return null
	if (typeof x.date === 'string') return { date: x.date }
	if (typeof x.start === 'string') {
		return typeof x.end === 'string' ? { start: x.start, end: x.end } : { start: x.start }
	}
	return null
}

function initState(source) {
	var items = []
	var raw = (source && source.items) || []
	var nextId = 1
	for (var i = 0; i < raw.length; i++) {
		var it = raw[i]
		if (!it || typeof it.title !== 'string') continue
		items.push({
			id: 'w' + nextId++,
			title: it.title,
			status: STATUS_LABEL[it.status] ? it.status : 'open',
			spark: isSpark(it.spark) ? it.spark : 'me',
			tags: cleanTags(it.tags),
			due: cleanDue(it.due),
			responsible: typeof it.responsible === 'string' ? it.responsible : ''
		})
	}
	return present({
		items: items,
		active: isSpark(source && source.active) ? source.active : 'me',
		nextId: nextId
	})
}

function byId(items, id) {
	for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]
	return null
}

function idList(payload) {
	if (payload && Object.prototype.toString.call(payload.ids) === '[object Array]') {
		var out = []
		for (var i = 0; i < payload.ids.length; i++) {
			if (typeof payload.ids[i] === 'string') out.push(payload.ids[i])
		}
		return out
	}
	if (payload && typeof payload.id === 'string') return [payload.id]
	return []
}

function reduce(state, ev) {
	var domain = { items: state.items.slice(), active: state.active, nextId: state.nextId }
	var payload = ev.payload || {}
	var i, item

	if (ev.send === 'CREATE' || ev.send === 'ADD') {
		var titles = []
		if (Object.prototype.toString.call(payload.titles) === '[object Array]') {
			for (i = 0; i < payload.titles.length; i++) {
				if (typeof payload.titles[i] === 'string') titles.push(payload.titles[i])
			}
		} else if (typeof payload.text === 'string') {
			titles = [payload.text]
		}
		var spark = isSpark(payload.spark) ? payload.spark : domain.active
		var created = []
		for (i = 0; i < titles.length; i++) {
			var title = titles[i].trim()
			if (title === '') continue
			var made = {
				id: 'w' + domain.nextId++,
				title: title,
				status: 'open',
				spark: spark,
				tags: cleanTags(payload.tags),
				due: cleanDue(payload.due),
				responsible: typeof payload.responsible === 'string' ? payload.responsible : ''
			}
			domain.items.push(made)
			created.push(made)
		}
		if (created.length === 0)
			return speak(domain, 'no titles given', { ok: false, error: 'no titles given' })
		return speak(domain, 'created (' + created.length + '): ' + lines(created), {
			ok: true,
			created: created
		})
	}

	if (ev.send === 'UPDATE') {
		var ids = idList(payload)
		if (ids.length === 0)
			return speak(
				domain,
				'no valid ids given — take the ids from this list. ' + listSaid(domain.items),
				{ ok: false, error: 'no valid ids given', items: domain.items }
			)
		var status = WIRE_STATUS[payload.status]
		if (!status && typeof payload.done === 'boolean') status = payload.done ? 'done' : 'open'
		var updated = []
		var unknown = []
		var rejected = []
		for (i = 0; i < ids.length; i++) {
			item = byId(domain.items, ids[i])
			if (!item) {
				unknown.push(ids[i])
				continue
			}
			var changed = false
			// The gate: a status change is applied only if the machine allows
			// that move; an illegal one (e.g. done -> doing) is refused, the
			// task left untouched.
			if (status && status !== item.status) {
				if (legalStatus(item.status, status)) {
					item.status = status
					changed = true
				} else {
					rejected.push(item.id + ' ' + item.status + '->' + status)
				}
			}
			if (typeof payload.title === 'string' && payload.title.trim() !== '') {
				item.title = payload.title.trim()
				changed = true
			}
			if (payload.tags !== undefined) {
				item.tags = cleanTags(payload.tags)
				changed = true
			}
			if (payload.due !== undefined) {
				item.due = cleanDue(payload.due)
				changed = true
			}
			if (typeof payload.responsible === 'string') {
				item.responsible = payload.responsible
				changed = true
			}
			if (isSpark(payload.spark)) {
				item.spark = payload.spark
				changed = true
			}
			if (changed) updated.push(item)
		}
		var notes = []
		if (unknown.length > 0) notes.push('unknown ids: ' + unknown.join(', '))
		if (rejected.length > 0) notes.push('illegal transition: ' + rejected.join(', '))
		var said =
			updated.length === 0
				? 'nothing changed' + (notes.length > 0 ? '; ' + notes.join('; ') : '')
				: 'changed (' + updated.length + '): ' + lines(updated) +
					(notes.length > 0 ? '. ' + notes.join('; ') : '')
		return speak(domain, said, {
			ok: updated.length > 0,
			updated: updated,
			unknownIds: unknown,
			rejected: rejected
		})
	}

	if (ev.send === 'DELETE') {
		var gone = idList(payload)
		if (gone.length === 0)
			return speak(
				domain,
				'no valid ids given — take the ids from this list. ' + listSaid(domain.items),
				{ ok: false, error: 'no valid ids given', items: domain.items }
			)
		var kept = []
		var deleted = []
		var missing = []
		for (var g = 0; g < gone.length; g++) {
			if (!byId(domain.items, gone[g])) missing.push(gone[g])
		}
		for (i = 0; i < domain.items.length; i++) {
			var keep = true
			for (var j = 0; j < gone.length; j++) if (domain.items[i].id === gone[j]) keep = false
			if (keep) kept.push(domain.items[i])
			else deleted.push(domain.items[i])
		}
		domain.items = kept
		var saidDel =
			deleted.length === 0
				? 'nothing deleted; unknown ids: ' + missing.join(', ')
				: 'deleted (' + deleted.length + '): ' + lines(deleted)
		return speak(domain, saidDel, {
			ok: deleted.length > 0,
			deleted: deleted,
			unknownIds: missing
		})
	}

	if (ev.send === 'TOGGLE') {
		item = byId(domain.items, payload.id)
		if (item) {
			var toggled = item.status === 'done' ? 'open' : 'done'
			if (legalStatus(item.status, toggled)) item.status = toggled
		}
		return present(domain)
	}

	if (ev.send === 'CYCLE') {
		item = byId(domain.items, payload.id)
		if (item) item.status = nextStatus(item.status)
		return present(domain)
	}

	if (ev.send === 'SHOW') {
		if (isSpark(payload.spark)) domain.active = payload.spark
		return speak(domain, 'The active spark is now ' + domain.active + '.', {
			ok: true,
			spark: domain.active
		})
	}

	if (ev.send === 'CLEAR_DONE') {
		var left = []
		var cleared = []
		for (i = 0; i < domain.items.length; i++) {
			if (domain.items[i].spark !== domain.active || domain.items[i].status !== 'done')
				left.push(domain.items[i])
			else cleared.push(domain.items[i])
		}
		domain.items = left
		return speak(
			domain,
			cleared.length === 0 ? 'deleted: nothing' : 'deleted (' + cleared.length + '): ' + lines(cleared),
			{ ok: true, deleted: cleared }
		)
	}

	if (ev.send === 'LIST') {
		return speak(domain, listSaid(domain.items), { ok: true, items: domain.items })
	}

	return state
}

/**
 * Raw model text in, validated transitions out — or null. Accepted shape:
 * {"ops": [{"op": "create", "titles": [...]}, {"op": "update", "ids": [...],
 * "status": ...}, {"op": "delete", "ids": [...]}]}. Everything else is
 * garbage and changes nothing.
 */
function shape(state, rawText) {
	var parsed
	try {
		parsed = JSON.parse(rawText)
	} catch (e) {
		return null
	}
	if (!parsed || Object.prototype.toString.call(parsed.ops) !== '[object Array]') return null
	var EVENT_FOR = { create: 'CREATE', update: 'UPDATE', 'delete': 'DELETE' }
	var next = state
	var applied = []
	for (var i = 0; i < parsed.ops.length; i++) {
		var op = parsed.ops[i]
		var send = op && EVENT_FOR[op.op]
		if (!send) return null
		var outcome = reduce(next, { send: send, payload: op })
		next = outcome.state || outcome
		applied.push({ op: op.op })
	}
	return { state: next, ops: applied }
}
`
