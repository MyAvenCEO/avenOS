function str(x) {
	return typeof x === 'string' ? x : ''
}

function arr(x) {
	return Array.isArray(x) ? x : []
}

function initState(source) {
	var s = source || {}
	var files = arr(s.files).map((f) => ({
		icon: str(f.icon) || '📄',
		name: str(f.name),
		meta: str(f.meta),
		kind: str(f.kind)
	}))
	return {
		eyebrow: str(s.eyebrow) || 'Vault',
		title: str(s.title) || 'Dateien',
		count: String(files.length),
		emptyMessage: str(s.emptyMessage) || 'Noch keine Dateien.',
		files: files
	}
}
