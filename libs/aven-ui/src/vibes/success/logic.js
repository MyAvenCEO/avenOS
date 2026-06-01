function str(x) {
	return typeof x === 'string' ? x : ''
}

function initState(source) {
	var s = source || {}
	return {
		badge: str(s.badge) || 'Erfolg',
		eyebrow: str(s.eyebrow) || 'Automatisierung abgeschlossen',
		title: str(s.title),
		messageLabel: str(s.messageLabel) || 'Ergebnis:',
		message: str(s.message),
		hint: str(s.hint),
	}
}
