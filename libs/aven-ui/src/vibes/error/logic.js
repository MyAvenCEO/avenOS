function str(x) {
	return typeof x === 'string' ? x : ''
}

function initState(source) {
	var s = source || {}
	return {
		badge: str(s.badge) || 'Systemfehler',
		eyebrow: str(s.eyebrow) || 'Automatisierung gestoppt',
		title: str(s.title),
		messageLabel: str(s.messageLabel) || 'Grund:',
		message: str(s.message)
	}
}
