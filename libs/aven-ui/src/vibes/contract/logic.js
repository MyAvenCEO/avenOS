function pad2(n) {
	return n < 10 ? '0' + n : String(n)
}

function fmtDate(s) {
	if (!s || !String(s).trim()) return ''
	var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
	if (m) {
		var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
		if (!isNaN(d.getTime())) {
			return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear()
		}
	}
	return String(s).trim()
}

function isRecord(x) {
	return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function str(x) {
	return typeof x === 'string' ? x.trim() : ''
}

function buildParty(p, idx) {
	if (!isRecord(p)) p = {}
	var role = str(p.role) || 'Partei ' + (idx + 1)
	var lines = []
	if (str(p.legal_form)) lines.push({ text: str(p.legal_form) })
	if (str(p.registration)) lines.push({ text: str(p.registration) })
	if (str(p.address)) lines.push({ text: str(p.address) })
	if (str(p.representative)) lines.push({ text: 'Vertreten durch: ' + str(p.representative) })
	if (str(p.email)) lines.push({ text: str(p.email) })
	return { role: role, name: str(p.name) || '–', lines: lines }
}

function buildClauses(clauses) {
	return (Array.isArray(clauses) ? clauses : []).map((c) => {
		if (!isRecord(c)) c = {}
		var sub = Array.isArray(c.subclauses) ? c.subclauses : []
		return {
			num: str(c.number),
			title: str(c.title),
			body: typeof c.body === 'string' ? c.body.trim() : '',
			subclauses: sub
				.map((s) => {
					if (!isRecord(s)) return null
					return {
						label: typeof s.label === 'string' ? s.label : '',
						body: typeof s.body === 'string' ? s.body : ''
					}
				})
				.filter((s) => s && (s.label || s.body))
		}
	})
}

function buildSignatures(signatures, parties) {
	return (Array.isArray(signatures) ? signatures : [])
		.map((sig) => {
			if (!isRecord(sig)) return null
			var idx =
				typeof sig.party_index === 'number' && !isNaN(sig.party_index) ? sig.party_index : -1
			var partyLab = 'Signatur'
			if (idx >= 0 && Array.isArray(parties) && isRecord(parties[idx])) {
				partyLab = str(parties[idx].role) || 'Partei ' + (idx + 1)
			}
			var place = typeof sig.place === 'string' ? sig.place : ''
			var date = fmtDate(sig.date)
			var metaBits = []
			if (place) metaBits.push('Ort: ' + place)
			if (date) metaBits.push('Datum: ' + date)
			return {
				party: partyLab,
				name: typeof sig.signer_name === 'string' ? sig.signer_name : '—',
				role: typeof sig.signer_role === 'string' ? sig.signer_role : '',
				meta: metaBits.join(' · ')
			}
		})
		.filter((b) => b)
}

function initState(source) {
	var s = source || {}
	var parties = Array.isArray(s.parties) ? s.parties : []

	var meta = []
	if (str(s.contract_id)) meta.push({ label: 'Kennung:', value: ' ' + str(s.contract_id) })
	var eff = fmtDate(s.effective_date)
	if (eff) meta.push({ label: 'Inkrafttreten:', value: ' ' + eff })
	if (str(s.jurisdiction)) meta.push({ label: 'Rechtsordnung:', value: ' ' + str(s.jurisdiction) })
	if (str(s.language)) meta.push({ label: 'Sprache:', value: ' ' + str(s.language).toUpperCase() })

	var preamble = []
	if (str(s.preamble)) preamble.push({ text: str(s.preamble) })

	var defs = (Array.isArray(s.definitions) ? s.definitions : [])
		.map((d) => {
			if (!isRecord(d)) return null
			var term = str(d.term)
			var def = str(d.definition)
			if (!term && !def) return null
			return { term: term || 'Begriff', body: def }
		})
		.filter((d) => d)
	var defsSection = defs.length ? [{ rows: defs }] : []

	var clauses = buildClauses(s.clauses)
	var clausesEmpty = clauses.length ? [] : [{ text: 'Keine Klauseln übermittelt.' }]

	var blocks = buildSignatures(s.signatures, parties)
	var signSection = blocks.length ? [{ blocks: blocks }] : []

	var footnote = []
	if (str(s.signature_note)) footnote.push({ text: str(s.signature_note) })

	return {
		eyebrow: str(s.contract_type) || 'Vertrag',
		title: str(s.title) || 'Vertrag',
		meta: meta,
		parties: parties.map(buildParty),
		preamble: preamble,
		defsSection: defsSection,
		clauses: clauses,
		clausesEmpty: clausesEmpty,
		signSection: signSection,
		footnote: footnote
	}
}
