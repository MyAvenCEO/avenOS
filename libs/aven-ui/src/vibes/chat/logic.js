function str(x) {
	return typeof x === 'string' ? x : ''
}

function arr(x) {
	return Array.isArray(x) ? x : []
}

// biome-ignore lint/correctness/noUnusedVariables: called by name inside the QuickJS sandbox (app/src/lib/actors/sandbox.ts)
function initState(source) {
	var s = source || {}
	var messages = arr(s.messages).map((m) => {
		var own = str(m.role) === 'user'
		var agent = str(m.role) === 'agent'
		return {
			author: str(m.author),
			time: str(m.time),
			body: str(m.body),
			rowClass: `ch-row${own ? ' ch-row--own' : agent ? ' ch-row--agent' : ''}`,
			bubbleClass: `ch-bubble${own ? ' ch-bubble--own' : agent ? ' ch-bubble--agent' : ''}`
		}
	})
	return {
		eyebrow: str(s.eyebrow),
		title: str(s.title) || 'Talk',
		subtitle: str(s.subtitle),
		messages: messages
	}
}
