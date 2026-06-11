function str(x) {
	return typeof x === 'string' ? x : ''
}

function arr(x) {
	return Array.isArray(x) ? x : []
}

function initState(source) {
	var s = source || {}

	var levels = arr(s.accessLevels).map((l) => ({
		label: str(l.label),
		pillClass: 'mb-pill' + (l && l.active ? ' mb-pill--active' : '')
	}))

	var entries = arr(s.entries).map((e) => ({
		kind: str(e.kind),
		name: str(e.name),
		did: str(e.did),
		perms: arr(e.perms).map((p) => ({
			label: str(p.label),
			chipClass: 'mb-chip' + (p && p.on ? ' mb-chip--on' : '')
		}))
	}))

	return {
		didPlaceholder: str(s.didPlaceholder) || "Paste a member's DID (did:key:…)",
		accessEyebrow: str(s.accessEyebrow) || 'Access level',
		accessLevels: levels,
		hint: str(s.hint),
		grantLabel: str(s.grantLabel) || 'Grant access',
		note: str(s.note),
		whoEyebrow: str(s.whoEyebrow) || 'Who has access',
		entries: entries
	}
}
