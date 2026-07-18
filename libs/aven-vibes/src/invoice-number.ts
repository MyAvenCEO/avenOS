// board 0082 — outgoing-invoice numbering. A number is `<PREFIX>-<contactShortId>-<seq>` where the
// seq is a per-(prefix, contact) running counter — each customer + state has its own gapless
// Nummernkreis, unique by design because the contact id differs. Prefixes: R Rechnung, A Angebot,
// E Entwurf. No year separator. Pure (no DOM): derivation + parsing + next-seq.

export type InvoiceState = 'entwurf' | 'angebot' | 'rechnung'

export const STATE_PREFIX: Record<InvoiceState, 'E' | 'A' | 'R'> = {
	entwurf: 'E',
	angebot: 'A',
	rechnung: 'R'
}

/** `<PREFIX>-<shortId>-<seq>` with a 4-digit zero-padded running counter, e.g. `R-7GD7F7A2-0001`. */
export function invoiceNumber(state: InvoiceState, shortId: string, seq: number): string {
	return `${STATE_PREFIX[state]}-${shortId}-${String(seq).padStart(4, '0')}`
}

export type ParsedNumber = { prefix: 'E' | 'A' | 'R'; shortId: string; seq: number }

// The id segment is parsed loosely (any 8 uppercase alphanumerics) so parsing isn't coupled to the
// mint alphabet; minted ids (Crockford base32) are a subset.
const NUMBER_RE = /^([EAR])-([0-9A-Z]{8})-(\d+)$/

export function parseInvoiceNumber(num: string): ParsedNumber | null {
	const m = NUMBER_RE.exec(num)
	if (!m) return null
	return { prefix: m[1] as 'E' | 'A' | 'R', shortId: m[2], seq: Number(m[3]) }
}

/**
 * Next running sequence for a (state, contact) series: max existing seq of that prefix+contact + 1,
 * starting at 1. Gapless per series; ignores numbers of other contacts/states.
 */
export function nextSeq(
	existingNumbers: Iterable<string>,
	state: InvoiceState,
	shortId: string
): number {
	const prefix = STATE_PREFIX[state]
	let max = 0
	for (const n of existingNumbers) {
		const p = parseInvoiceNumber(n)
		if (p && p.prefix === prefix && p.shortId === shortId) max = Math.max(max, p.seq)
	}
	return max + 1
}

/** Assign the next number for a (state, contact), given the contact's existing numbers. */
export function assignInvoiceNumber(
	existingNumbers: Iterable<string>,
	state: InvoiceState,
	shortId: string
): string {
	return invoiceNumber(state, shortId, nextSeq(existingNumbers, state, shortId))
}
