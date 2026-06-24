var TYPE_LABELS = {
	invoice: 'Rechnung',
	bank_statement: 'Kontoauszug',
	contract: 'Vertrag',
	other: 'Sonstiges'
}

// The full chip class is computed here (never spliced in the view): the engine forbids a $ref
// inside a class string, so the class attribute is one $ref ($chipClass) resolving to this. The
// runtime validator also rejects an empty class, so this is ALWAYS a valid non-empty value.
function chipClassFor(docType) {
	return `bk-type-chip bk-type-chip--${docType || 'other'}`
}

// Visibility is class-driven (.bk-hidden) instead of [src] attribute selectors, which the engine
// forbids. With a preview URL: show the image, hide the fallback text — and vice versa. Both values
// are always a non-empty valid class (the runtime class validator rejects empty strings).
function imgClassFor(hasPreview) {
	return hasPreview ? 'bk-img' : 'bk-img bk-hidden'
}
function noPreviewClassFor(hasPreview) {
	return hasPreview ? 'bk-no-preview bk-hidden' : 'bk-no-preview'
}

// The engine's $each only resolves $$<field> on OBJECT items (a bare string item yields undefined),
// so tags must be wrapped as { label }.
function tagObjects(tags) {
	var out = []
	var i, t
	if (Array.isArray(tags)) {
		for (i = 0; i < tags.length; i++) {
			t = String(tags[i] == null ? '' : tags[i]).trim()
			if (t) out.push({ label: t })
		}
	}
	return out
}

// Parties involved, surfaced as { role, name } rows: the issuing party ("identity of the party"),
// the recipient, and any other involved parties the classifier extracted.
function partyObjects(issuer, recipient, parties) {
	var out = []
	var i, p
	if (issuer) out.push({ role: 'Aussteller', name: String(issuer) })
	if (recipient) out.push({ role: 'Empfänger', name: String(recipient) })
	if (Array.isArray(parties)) {
		for (i = 0; i < parties.length; i++) {
			p = String(parties[i] == null ? '' : parties[i]).trim()
			if (p) out.push({ role: 'Beteiligt', name: p })
		}
	}
	return out
}

function buildState(src, isEmpty) {
	var docType = src.docType || null
	var fileUrl = String(src.fileUrl || '')
	var parties = partyObjects(src.issuer, src.recipient, src.parties)
	return {
		docType: docType || 'other',
		chipClass: chipClassFor(docType),
		docTypeLabel: isEmpty ? '' : TYPE_LABELS[docType] || TYPE_LABELS.other,
		title: src.title || '',
		description: src.description || '',
		tags: tagObjects(src.tags),
		parties: parties,
		partiesLabel: parties.length ? 'Beteiligte' : '',
		fileUrl: fileUrl,
		mimeType: String(src.mimeType || ''),
		imgClass: imgClassFor(!!fileUrl),
		noPreviewClass: noPreviewClassFor(!!fileUrl),
		eyebrow: isEmpty ? '' : 'Dokument erkannt',
		emptyLabel: isEmpty ? 'Datei anhängen und klassifizieren lassen.' : '',
		noPreviewLabel: 'Keine Vorschau verfügbar.'
	}
}

function initState(source) {
	source = source || {}
	return buildState(source, !source.docType)
}

// biome-ignore lint/correctness/noUnusedVariables: called by the vibe engine via QuickJS by convention
function handleEvent(type, payload, state) {
	payload = payload || {}

	if (type === 'SET_CLASSIFICATION') {
		return buildState(
			{
				docType: String(payload.docType || 'other'),
				title: payload.title,
				description: payload.description,
				tags: payload.tags,
				issuer: payload.issuer,
				recipient: payload.recipient,
				parties: payload.parties,
				fileUrl: payload.fileUrl || state.fileUrl || '',
				mimeType: payload.mimeType || state.mimeType || ''
			},
			false
		)
	}

	if (type === 'RESET') {
		return initState({})
	}

	return state
}
