// Generic structured-document vibe logic (QuickJS). The per-type mapper already produces the full
// DocView shape, so initState just normalizes it; there are no interactive events. board 0064.

function initState(source) {
	source = source || {}
	return {
		title: source.title || '',
		subtitle: source.subtitle || '',
		sections: Array.isArray(source.sections) ? source.sections : []
	}
}

// biome-ignore lint/correctness/noUnusedVariables: called by the vibe engine via QuickJS by convention
function handleEvent(_type, _payload, state) {
	return state
}
