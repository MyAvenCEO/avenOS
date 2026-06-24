import { arr, rec, str } from '../_doc/map.js'

// board 0065 — after a bank_statement is extracted, fan its transactions out into a flat, clean
// `tx` schema in the AvenDB data store. Pure (no DOM): the server imports this to normalize +
// dedup. Each tx carries a deterministic `dedup_key` so re-extracting the same statement is
// idempotent (the caller skips keys it already has).

/** The JSON Schema registered as the user's `tx` schema (validated by Ajv on write, like todos). */
export const TX_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['dedup_key'],
	properties: {
		dedup_key: {
			type: 'string',
			description: 'Deterministic idempotency key (transaction_id if present, else a field hash).'
		},
		booking_date: { type: ['string', 'null'], description: 'Posting date (Datum Buchung).' },
		value_date: { type: ['string', 'null'], description: 'Value date (Datum Beleg / Wert).' },
		amount: {
			type: ['number', 'null'],
			description: 'Signed amount in the ACCOUNT currency (negative = outgoing debit).'
		},
		currency: { type: ['string', 'null'], description: 'Account/booking currency (e.g. EUR).' },
		original_amount: {
			type: ['number', 'null'],
			description:
				'For FX bookings: the amount in the ORIGINAL currency (e.g. the USD charge behind a EUR debit).'
		},
		original_currency: {
			type: ['string', 'null'],
			description: 'ISO currency of original_amount (e.g. USD).'
		},
		exchange_rate: { type: ['number', 'null'], description: 'Umrechnungskurs applied, if shown.' },
		description: { type: ['string', 'null'], description: 'Verwendungszweck / purpose text.' },
		counterparty_name: { type: ['string', 'null'] },
		counterparty_iban: { type: ['string', 'null'], description: "Counterparty's IBAN/account." },
		balance_after: { type: ['number', 'null'] },
		account_iban: {
			type: ['string', 'null'],
			description: 'IBAN of the account this tx belongs to.'
		},
		statement_id: { type: ['string', 'null'], description: 'Source statement identifier.' },
		source_value_id: {
			type: ['string', 'null'],
			description: 'data_value id of the bank_statement this tx was extracted from.'
		}
	}
} as const

export type TxRecord = {
	dedup_key: string
	booking_date: string | null
	value_date: string | null
	amount: number | null
	currency: string | null
	original_amount: number | null
	original_currency: string | null
	exchange_rate: number | null
	description: string | null
	counterparty_name: string | null
	counterparty_iban: string | null
	balance_after: number | null
	account_iban: string | null
	statement_id: string | null
	source_value_id: string | null
}

function numOrNull(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
	return null
}

/**
 * Deterministic dedup key for a transaction. Prefer the bank's own `transaction_id`; otherwise hash
 * the stable identifying fields (account · date · amount · purpose). Same statement → same keys.
 */
export function txDedupKey(tx: Record<string, unknown>, accountIban: string): string {
	const tid = str(tx.transaction_id)
	if (tid) return `tid:${tid}`
	const parts = [
		accountIban,
		str(tx.booking_date) || str(tx.value_date),
		String(numOrNull(tx.amount) ?? ''),
		str(tx.description) || str(tx.counterparty_name) || str(tx.title)
	]
	return `h:${parts.join('|')}`
}

/**
 * Normalize a raw extracted bank_statement into flat {@link TxRecord}s — one per posted line,
 * each with a `dedup_key`. `sourceValueId` is the data_value id of the stored statement (for trace).
 */
export function bankStatementToTransactions(
	extracted: unknown,
	sourceValueId: string | null = null
): TxRecord[] {
	const d = rec(extracted)
	const ov = rec(d.account_overview)
	const iban = str(ov.iban)
	const currency = str(d.currency) || null
	const statementId = str(d.statement_id) || null

	return arr(d.transactions).map((raw) => {
		const t = rec(raw)
		const description = [str(t.title), str(t.description)].filter(Boolean).join(' — ') || null
		return {
			dedup_key: txDedupKey(t, iban),
			booking_date: str(t.booking_date) || null,
			value_date: str(t.value_date) || null,
			amount: numOrNull(t.amount),
			currency,
			original_amount: numOrNull(t.original_amount),
			original_currency: str(t.original_currency) || null,
			exchange_rate: numOrNull(t.exchange_rate),
			description,
			counterparty_name: str(t.counterparty_name) || null,
			counterparty_iban: str(t.counterparty_iban) || null,
			balance_after: numOrNull(t.balance_after),
			account_iban: iban || null,
			statement_id: statementId,
			source_value_id: sourceValueId
		}
	})
}

/** Idempotent filter: keep only tx whose dedup_key is not already present. */
export function newTransactions(txs: TxRecord[], existingKeys: Set<string>): TxRecord[] {
	const seen = new Set(existingKeys)
	const out: TxRecord[] = []
	for (const t of txs) {
		if (seen.has(t.dedup_key)) continue
		seen.add(t.dedup_key) // also dedup within this batch
		out.push(t)
	}
	return out
}
