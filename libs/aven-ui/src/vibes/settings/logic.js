function str(x) {
	return typeof x === 'string' ? x : ''
}

function arr(x) {
	return Array.isArray(x) ? x : []
}

function initState(source) {
	var s = source || {}
	var sections = arr(s.sections).map((sec) => ({
		label: str(sec.label),
		items: arr(sec.items).map((it) => ({
			label: str(it.label),
			value: str(it.value),
			hint: str(it.hint)
		}))
	}))
	return {
		eyebrow: str(s.eyebrow),
		title: str(s.title) || 'Einstellungen',
		sections: sections
	}
}
