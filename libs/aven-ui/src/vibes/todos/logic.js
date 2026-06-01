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
	emptyList: 'Noch keine Aufgaben — oben hinzufügen.',
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
	return (items || []).map(function (it) {
		return {
			id: String(it.id || uid()),
			text: it.text || '',
			done: !!it.done,
			rowClass: it.done ? 'td-row done' : 'td-row',
		}
	})
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
		hasDone: items.some(function (i) { return i.done }),
		items: items,
		emptyMessage: labels.emptyList,
		isEmpty: items.length === 0,
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
			isEmpty: items.length === 0,
		}
	}

	if (type === 'ADD_ITEM') {
		var text = (payload.text != null ? String(payload.text) : draft).trim()
		if (!text) return state
		items.push({ id: uid(), text: text, done: false, rowClass: 'td-row' })
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
					rowClass: !items[i].done ? 'td-row done' : 'td-row',
				}
				break
			}
		}
	}

	if (type === 'DELETE_ITEM') {
		var did = payload.id
		items = items.filter(function (it) { return it.id !== did })
	}

	if (type === 'CLEAR_DONE') {
		items = items.filter(function (it) { return !it.done })
	}

	return {
		labels: state.labels,
		title: state.title,
		openCount: computeOpenCount(items),
		draft: draft,
		hasDone: items.some(function (i) { return i.done }),
		items: items,
		emptyMessage: state.labels.emptyList,
		isEmpty: items.length === 0,
	}
}
