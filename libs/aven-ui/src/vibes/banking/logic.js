var DEFAULT_LABELS = {
	walletEyebrow: 'aEUR Wallet',
	addressLabel: 'Adresse',
	mintTitle: 'Prägen (nur Admin)',
	mintButton: 'Prägen',
	sendTitle: 'Senden',
	sendButton: 'Senden',
	recipientLabel: 'Empfänger',
	amountPlaceholder: 'Betrag, z. B. 50,00',
	historyTitle: 'Transaktionen',
	chainTag: 'signiert · hash-verkettet',
	emptyHistory: 'Noch keine Transaktionen.',
	noRecipients: 'Keine weiteren Nutzer.'
}

function mergeLabels(source) {
	var labels = (source && source.labels) || {}
	var merged = {}
	var k
	for (k in DEFAULT_LABELS) merged[k] = DEFAULT_LABELS[k]
	for (k in labels) merged[k] = labels[k]
	return merged
}

function pad2(n) {
	return n < 10 ? '0' + n : '' + n
}

// Minor units (cents) → "1234.56 aEUR", integer math only (no float drift).
function fmt(minor, token) {
	var neg = minor < 0
	var abs = Math.abs(minor)
	var major = Math.floor(abs / 100)
	var cents = abs % 100
	var sym = (token && token.symbol) || 'aEUR'
	return (neg ? '−' : '') + major + '.' + pad2(cents) + ' ' + sym
}

// "50" / "50,00" / "50.5" → minor units (integer). Bad input → 0.
function parseMinor(str) {
	if (str == null) return 0
	var cleaned = String(str).replace(/\s/g, '').replace(',', '.')
	if (cleaned === '') return 0
	var val = parseFloat(cleaned)
	if (!isFinite(val) || val < 0) return 0
	return Math.round(val * 100)
}

function shortAddr(a) {
	if (!a) return '—'
	if (a.length <= 12) return a
	return a.slice(0, 6) + '…' + a.slice(-4)
}

function mapRecipients(recipients, selected) {
	return (recipients || []).map((r) => ({
		id: String(r.id || r.address),
		email: r.email || shortAddr(r.address),
		address: r.address,
		recipientClass: r.address === selected ? 'bk-chip bk-chip--on' : 'bk-chip'
	}))
}

function mapTxs(txs, address, token) {
	return (txs || []).map((t) => {
		var mint = t.kind === 'mint'
		var incoming = mint || t.to_address === address
		var amt = (incoming ? '+' : '−') + ' ' + fmt(t.amount, token)
		var label = mint ? 'Geprägt' : incoming ? 'Erhalten' : 'Gesendet'
		var party = mint
			? 'neue aEUR'
			: incoming
				? 'von ' + shortAddr(t.from_address)
				: 'an ' + shortAddr(t.to_address)
		var verified = t.verified !== false
		return {
			id: String(t.id || t.seq),
			label: label,
			counterparty: party,
			amountDisplay: amt,
			amountClass: incoming ? 'bk-tx-amount bk-tx-amount--in' : 'bk-tx-amount bk-tx-amount--out',
			rowClass: incoming ? 'bk-tx bk-tx--in' : 'bk-tx bk-tx--out',
			verifiedLabel: verified ? '✓ signiert' : '⚠ ungültig',
			verifiedClass: verified ? 'bk-tx-verified' : 'bk-tx-verified bk-tx-verified--bad'
		}
	})
}

// Recompute the whole derived view-state from the raw ledger numbers.
function render(s) {
	return {
		labels: s.labels,
		token: s.token,
		isAdmin: s.isAdmin ? 'true' : 'false',
		address: s.address,
		addressShort: shortAddr(s.address),
		balanceRaw: s.balanceRaw,
		balanceDisplay: fmt(s.balanceRaw, s.token),
		supplyRaw: s.supplyRaw,
		supplyDisplay: 'Gesamtmenge: ' + fmt(s.supplyRaw, s.token),
		mintAmount: s.mintAmount || '',
		sendAmount: s.sendAmount || '',
		recipients: mapRecipients(s.recipients, s.selectedRecipient),
		selectedRecipient: s.selectedRecipient || '',
		rawRecipients: s.recipients || [],
		txsRaw: s.txsRaw,
		txs: mapTxs(s.txsRaw, s.address, s.token),
		notice: s.notice || '',
		isEmpty: (s.txsRaw || []).length === 0
	}
}

function initState(source) {
	source = source || {}
	var token = source.token || { symbol: 'aEUR', decimals: 2 }
	var recipients = source.recipients || []
	return render({
		labels: mergeLabels(source),
		token: token,
		isAdmin: !!source.isAdmin,
		address: source.address || '0x0000000000000000000000000000000000000000',
		balanceRaw: typeof source.balance === 'number' ? source.balance : 0,
		supplyRaw: typeof source.totalSupply === 'number' ? source.totalSupply : 0,
		mintAmount: '',
		sendAmount: '',
		recipients: recipients,
		selectedRecipient: recipients[0] ? recipients[0].address : '',
		txsRaw: source.txs || [],
		notice: ''
	})
}

function nextSeq(txsRaw) {
	var max = 0
	for (var i = 0; i < txsRaw.length; i++) {
		var s = Number(txsRaw[i].seq || 0)
		if (s > max) max = s
	}
	return max + 1
}

function handleEvent(type, payload, state) {
	payload = payload || {}
	// Reconstruct the raw working state from the rendered state.
	var s = {
		labels: state.labels,
		token: state.token,
		isAdmin: state.isAdmin === 'true' || state.isAdmin === true,
		address: state.address,
		balanceRaw: state.balanceRaw,
		supplyRaw: state.supplyRaw,
		mintAmount: state.mintAmount,
		sendAmount: state.sendAmount,
		recipients: state.rawRecipients || [],
		selectedRecipient: state.selectedRecipient,
		txsRaw: (state.txsRaw || []).slice(),
		notice: ''
	}

	if (type === 'SET_MINT_AMOUNT') {
		s.mintAmount = payload.value != null ? String(payload.value) : ''
		return render(s)
	}
	if (type === 'SET_SEND_AMOUNT') {
		s.sendAmount = payload.value != null ? String(payload.value) : ''
		return render(s)
	}
	if (type === 'SET_RECIPIENT') {
		s.selectedRecipient = payload.address || ''
		return render(s)
	}

	if (type === 'MINT') {
		if (!s.isAdmin) {
			s.notice = 'Nur Admins können prägen.'
			return render(s)
		}
		var mintMinor = parseMinor(s.mintAmount)
		if (mintMinor <= 0) {
			s.notice = 'Bitte einen Betrag eingeben.'
			return render(s)
		}
		s.balanceRaw += mintMinor
		s.supplyRaw += mintMinor
		s.txsRaw.push({
			id: 'local-' + nextSeq(s.txsRaw),
			seq: nextSeq(s.txsRaw),
			kind: 'mint',
			from_address: null,
			to_address: s.address,
			amount: mintMinor,
			verified: true
		})
		s.mintAmount = ''
		s.notice = ''
		return render(s)
	}

	if (type === 'SEND') {
		var sendMinor = parseMinor(s.sendAmount)
		if (!s.selectedRecipient) {
			s.notice = 'Bitte einen Empfänger wählen.'
			return render(s)
		}
		if (sendMinor <= 0) {
			s.notice = 'Bitte einen Betrag eingeben.'
			return render(s)
		}
		if (s.balanceRaw < sendMinor) {
			s.notice = 'Guthaben reicht nicht.'
			return render(s)
		}
		s.balanceRaw -= sendMinor
		s.txsRaw.push({
			id: 'local-' + nextSeq(s.txsRaw),
			seq: nextSeq(s.txsRaw),
			kind: 'transfer',
			from_address: s.address,
			to_address: s.selectedRecipient,
			amount: sendMinor,
			verified: true
		})
		s.sendAmount = ''
		s.notice = ''
		return render(s)
	}

	return render(s)
}
