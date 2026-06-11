var PREFIX = {
	passwords: 'pw.',
	'api-keys': 'api.'
}

function mergeLabels(source) {
	var labels = source?.labels || {}
	return {
		description: labels.description || '',
		addTitle: labels.addTitle || 'Add secret',
		idLabel: labels.idLabel || 'ID',
		valueLabel: labels.valueLabel || 'Value',
		listTitle: labels.listTitle || 'Stored secrets',
		empty: labels.empty || 'No secrets yet.',
		reveal: labels.reveal || 'Reveal',
		hide: labels.hide || 'Hide',
		addButton: labels.addButton || 'Add',
		delete: labels.delete || 'Delete',
		loading: labels.loading || 'Loading…'
	}
}

function matchesKind(kind, storageId) {
	var apiPrefix = PREFIX['api-keys']
	var _pwPrefix = PREFIX.passwords
	if (kind === 'api-keys') return storageId.indexOf(apiPrefix) === 0
	return storageId.indexOf(apiPrefix) !== 0
}

function toDisplayId(kind, storageId) {
	var prefix = PREFIX[kind] || PREFIX.passwords
	if (storageId.indexOf(prefix) === 0) return storageId.slice(prefix.length)
	return storageId
}

function mapItems(source) {
	var kind = source.kind || 'passwords'
	var revealed = source.revealed || {}
	var labels = mergeLabels(source)
	return (source.secrets || [])
		.filter((row) => row?.id && matchesKind(kind, row.id))
		.map((row) => {
			var id = String(row.id)
			var isRevealed = !!revealed[id]
			return {
				id: id,
				displayId: toDisplayId(kind, id),
				revealedText: isRevealed ? String(revealed[id]) : '',
				revealLabel: isRevealed ? labels.hide : labels.reveal,
				revealedClass: isRevealed ? 'vs-row-value' : 'vs-row-value vs-hidden',
				rowClass: 'vs-row'
			}
		})
}

function _initState(source) {
	source = source || {}
	var labels = mergeLabels(source)
	var loading = !!source.loading
	var error = source.error ? String(source.error) : ''
	var busy = !!source.busy
	var newId = source.newId != null ? String(source.newId) : ''
	var newValue = source.newValue != null ? String(source.newValue) : ''
	var items = mapItems(source)
	return {
		labels: labels,
		title: source.title || 'Secrets',
		description: labels.description,
		kind: source.kind || 'passwords',
		newId: newId,
		newValue: newValue,
		loading: loading,
		errorMessage: error,
		errorClass: error ? 'vs-error vs-has-error' : 'vs-error',
		loadingClass: loading ? 'vs-loading vs-is-loading' : 'vs-loading',
		loadingMessage: labels.loading,
		busy: busy,
		addDisabled: busy || !newId.trim(),
		isEmpty: !loading && items.length === 0,
		emptyMessage: labels.empty,
		items: items
	}
}

function _handleEvent(type, payload, state) {
	payload = payload || {}
	var newId = state.newId || ''
	var newValue = state.newValue || ''

	if (type === 'SET_NEW_ID') {
		newId = payload.text != null ? String(payload.text) : ''
	}
	if (type === 'SET_NEW_VALUE') {
		newValue = payload.text != null ? String(payload.text) : ''
	}

	return {
		labels: state.labels,
		title: state.title,
		description: state.description,
		kind: state.kind,
		newId: newId,
		newValue: newValue,
		loading: state.loading,
		errorMessage: state.errorMessage,
		errorClass: state.errorClass,
		loadingClass: state.loadingClass,
		loadingMessage: state.loadingMessage,
		busy: state.busy,
		addDisabled: state.busy || !newId.trim(),
		isEmpty: state.isEmpty,
		emptyMessage: state.emptyMessage,
		items: state.items
	}
}
