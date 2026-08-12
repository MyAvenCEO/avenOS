/**
 * The workitems behaviour, as DATA — a QuickJS program, not host code.
 *
 * Voice tools and UI clicks both end here: the actor maps either into the
 * same events and calls `reduce`, so the two paths are byte-identical by
 * construction (the parity the 0130 goal asserts). IDs are a deterministic
 * counter (`w1`, `w2`, …) — same events in, same state out, every time.
 *
 * `shape` is the only place raw model text becomes operations: it parses,
 * validates, and applies through the SAME transitions as reduce; anything
 * malformed returns null and the host state stays untouched.
 *
 * Kept as an exported string (not a .js?raw import) so bun tests and vite
 * load it the same way.
 */
export const workitemsLogic = `
var SPARKS = [
	{ id: 'me', name: 'Me' },
	{ id: 'team', name: 'Team' }
]
var STATUS_LABEL = { open: 'Open', doing: 'In Progress', done: 'Done' }
var WIRE_STATUS = { open: 'open', in_progress: 'doing', done: 'done' }

function isSpark(id) {
	for (var i = 0; i < SPARKS.length; i++) if (SPARKS[i].id === id) return true
	return false
}

function sparkName(id) {
	for (var i = 0; i < SPARKS.length; i++) if (SPARKS[i].id === id) return SPARKS[i].name
	return id
}

function row(item) {
	return {
		id: item.id,
		title: item.title,
		status: item.status,
		spark: item.spark,
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
	var statuses = ['open', 'doing', 'done']
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
			spark: isSpark(it.spark) ? it.spark : 'me'
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
		for (i = 0; i < titles.length; i++) {
			var title = titles[i].trim()
			if (title === '') continue
			domain.items.push({ id: 'w' + domain.nextId++, title: title, status: 'open', spark: spark })
		}
		return present(domain)
	}

	if (ev.send === 'UPDATE') {
		var ids = idList(payload)
		var status = WIRE_STATUS[payload.status]
		if (!status && typeof payload.done === 'boolean') status = payload.done ? 'done' : 'open'
		for (i = 0; i < ids.length; i++) {
			item = byId(domain.items, ids[i])
			if (!item) continue
			if (status) item.status = status
			if (typeof payload.title === 'string' && payload.title.trim() !== '')
				item.title = payload.title.trim()
			if (isSpark(payload.spark)) item.spark = payload.spark
		}
		return present(domain)
	}

	if (ev.send === 'DELETE') {
		var gone = idList(payload)
		var kept = []
		for (i = 0; i < domain.items.length; i++) {
			var keep = true
			for (var j = 0; j < gone.length; j++) if (domain.items[i].id === gone[j]) keep = false
			if (keep) kept.push(domain.items[i])
		}
		domain.items = kept
		return present(domain)
	}

	if (ev.send === 'TOGGLE') {
		item = byId(domain.items, payload.id)
		if (item) item.status = item.status === 'done' ? 'open' : 'done'
		return present(domain)
	}

	if (ev.send === 'CYCLE') {
		item = byId(domain.items, payload.id)
		if (item)
			item.status = item.status === 'open' ? 'doing' : item.status === 'doing' ? 'done' : 'open'
		return present(domain)
	}

	if (ev.send === 'SHOW') {
		if (isSpark(payload.spark)) domain.active = payload.spark
		return present(domain)
	}

	if (ev.send === 'CLEAR_DONE') {
		var left = []
		for (i = 0; i < domain.items.length; i++) {
			if (domain.items[i].spark !== domain.active || domain.items[i].status !== 'done')
				left.push(domain.items[i])
		}
		domain.items = left
		return present(domain)
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
		next = reduce(next, { send: send, payload: op })
		applied.push({ op: op.op })
	}
	return { state: next, ops: applied }
}
`
