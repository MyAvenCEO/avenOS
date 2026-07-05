var DEFAULT_LABELS = {
	listEyebrow: 'Aufgabenliste',
	openLabel: 'Offen',
	newSection: 'Neu',
	entriesSection: 'Einträge',
	addPlaceholder: 'Aufgabe beschreiben …',
	addButton: 'Hinzufügen',
	clearDone: 'Erledigte löschen',
	toggleAria: 'Als erledigt markieren',
	deleteAria: 'Löschen',
	emptyList: 'Noch keine Aufgaben — oben hinzufügen.'
}

function mergeLabels(source) {
	var labels = (source && source.labels) || {}
	var merged = {}
	var k
	for (k in DEFAULT_LABELS) merged[k] = DEFAULT_LABELS[k]
	for (k in labels) merged[k] = labels[k]
	return merged
}

function uid() {
	return Math.random().toString(36).slice(2, 10)
}

function mapItems(items) {
	var mapped = (items || []).map((it) => ({
		id: String(it.id || uid()),
		text: it.text || '',
		done: !!it.done,
		due: it.due || '', // relative due label + priority (board 0087) — must survive the transform
		priority: it.priority || '',
		// board 0112 — Planner: goal chip + sub-task nesting (parent = the parent task's row id).
		goal: it.goal || '',
		parent: it.parent || '',
		rowClass: 'td-row' + (it.done ? ' done' : '') + (it.parent ? ' sub' : '')
	}))
	return orderByParent(mapped)
}

// board 0112 — children render directly UNDER their parent (depth-first), keeping list order otherwise.
// An item whose parent isn't in the list renders as a root (never hidden).
function orderByParent(list) {
	var present = {}
	var i
	for (i = 0; i < list.length; i++) present[list[i].id] = true
	var roots = []
	var kids = {}
	for (i = 0; i < list.length; i++) {
		var it = list[i]
		if (it.parent && present[it.parent]) (kids[it.parent] = kids[it.parent] || []).push(it)
		else roots.push(it)
	}
	var out = []
	function walk(n) {
		out.push(n)
		var c = kids[n.id] || []
		for (var k = 0; k < c.length; k++) walk(c[k])
	}
	for (i = 0; i < roots.length; i++) walk(roots[i])
	return out
}

function computeOpenCount(items) {
	var open = 0
	for (var i = 0; i < items.length; i++) {
		if (!items[i].done) open++
	}
	return open + ' von ' + items.length + ' offen'
}

function initState(source) {
	source = source || {}
	var labels = mergeLabels(source)
	var items = mapItems(source.items)
	return {
		labels: labels,
		title: source.title || 'Aufgaben',
		openCount: computeOpenCount(items),
		draft: '',
		hasDone: items.some((i) => i.done),
		items: items,
		emptyMessage: labels.emptyList,
		isEmpty: items.length === 0
	}
}

function handleEvent(type, payload, state) {
	payload = payload || {}
	var items = (state.items || []).slice()
	var draft = state.draft || ''

	if (type === 'SET_DRAFT') {
		draft = payload.text != null ? String(payload.text) : ''
		return {
			labels: state.labels,
			title: state.title,
			openCount: state.openCount,
			draft: draft,
			hasDone: state.hasDone,
			items: items,
			emptyMessage: state.emptyMessage,
			isEmpty: items.length === 0
		}
	}

	if (type === 'ADD_ITEM') {
		var text = (payload.text != null ? String(payload.text) : draft).trim()
		if (!text) return state
		items.push({
			id: uid(),
			text: text,
			done: false,
			due: '',
			priority: '',
			goal: '',
			parent: '',
			rowClass: 'td-row'
		})
		draft = ''
	}

	if (type === 'TOGGLE_ITEM') {
		var tid = payload.id
		for (var i = 0; i < items.length; i++) {
			if (items[i].id === tid) {
				items[i] = {
					id: items[i].id,
					text: items[i].text,
					done: !items[i].done,
					due: items[i].due,
					priority: items[i].priority,
					goal: items[i].goal,
					parent: items[i].parent,
					rowClass:
						'td-row' + (!items[i].done ? ' done' : '') + (items[i].parent ? ' sub' : '')
				}
				break
			}
		}
	}

	if (type === 'DELETE_ITEM') {
		var did = payload.id
		items = items.filter((it) => it.id !== did)
	}

	if (type === 'CLEAR_DONE') {
		items = items.filter((it) => !it.done)
	}

	return {
		labels: state.labels,
		title: state.title,
		openCount: computeOpenCount(items),
		draft: draft,
		hasDone: items.some((i) => i.done),
		items: items,
		emptyMessage: state.labels.emptyList,
		isEmpty: items.length === 0
	}
}

// ─────────────────────────── agent tool (planner) ───────────────────────────
//
// The `todos` agent tool lives WITH the vibe. This runs in the QuickJS sandbox: it validates the
// model's `args` against the live `data` (the host passes the current todos as [{id,title,done}])
// and returns a PLAN — a list of CRUD `ops` + a machine-facing `toolResult`. The sandbox NEVER
// touches avenDB; the trusted host applies the plan (and gates deletes via HITL). Pure + JSON-only.
function executeTool(name, args, data) {
	if (name !== 'todos') return null
	args = args || {}
	data = data || []
	var action = String(args.action || '')
		.trim()
		.toLowerCase()
	var items = Array.isArray(args.items) ? args.items : []

	if (action === 'list') {
		return { action: 'list', ops: [], titles: [], errors: [], toolResult: JSON.stringify(data) }
	}
	if (action !== 'create' && action !== 'update' && action !== 'delete') {
		return {
			action: 'unknown',
			ops: [],
			titles: [],
			errors: ['unknown action: ' + (action || '?')],
			toolResult: JSON.stringify({ ok: false, error: 'unknown action' })
		}
	}
	if (items.length === 0) {
		return {
			action: action,
			ops: [],
			titles: [],
			errors: [action + ': items is empty'],
			toolResult: JSON.stringify({ ok: false, action: action, error: 'items is empty' })
		}
	}

	var byId = {}
	for (var d = 0; d < data.length; d++) byId[String(data[d].id)] = data[d]

	var ops = []
	var titles = []
	var errors = []
	for (var i = 0; i < items.length; i++) {
		var it = items[i] || {}
		if (action === 'create') {
			var title = String(it.title == null ? '' : it.title).trim()
			if (!title) {
				errors.push('create: missing title')
				continue
			}
			ops.push({ kind: 'create', title: title })
			titles.push(title)
			continue
		}
		var id = String(it.id == null ? '' : it.id).trim()
		var target = byId[id]
		if (!target) {
			errors.push(action + ': no todo with id "' + id + '"')
			continue
		}
		if (action === 'delete') {
			ops.push({ kind: 'delete', id: target.id })
			titles.push(target.title)
			continue
		}
		var patch = {}
		var newTitle = it.title == null ? '' : String(it.title).trim()
		if (newTitle) patch.title = newTitle
		if (typeof it.done === 'boolean') patch.done = it.done
		if (Object.keys(patch).length === 0) {
			errors.push('update: nothing to change on "' + id + '"')
			continue
		}
		ops.push({ kind: 'update', id: target.id, patch: patch })
		titles.push(target.title)
	}

	var toolResult = JSON.stringify({
		ok: errors.length === 0,
		action: action,
		changed: titles.length,
		errors: errors
	})
	return { action: action, ops: ops, titles: titles, errors: errors, toolResult: toolResult }
}
