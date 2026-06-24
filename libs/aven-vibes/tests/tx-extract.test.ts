import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
	bankStatementToTransactions,
	newTransactions,
	TX_SCHEMA
} from '../src/vibes/bank-statement/tx.js'

// board 0065 — a bank statement's transactions normalize into the `tx` schema, validate via the
// same Ajv the data store uses, and the dedup is idempotent (re-running adds nothing).

const ajv = new Ajv({ allErrors: true, strict: false })
const validateTx = ajv.compile(TX_SCHEMA)

const STATEMENT = {
	statement_kind: 'periodic_account_statement',
	currency: 'EUR',
	statement_id: 'ST-2026-04',
	account_overview: { iban: 'DE12345678901234567890' },
	transactions: [
		{
			booking_date: '2026-04-20',
			amount: 500,
			description: 'Eingang Rechnung',
			balance_after: 1500
		},
		{
			booking_date: '2026-04-22',
			amount: -42.5,
			description: 'Lastschrift Hetzner',
			transaction_id: 'TX-77'
		},
		// exact duplicate of the first row (no transaction_id) — must collapse via the field hash
		{
			booking_date: '2026-04-20',
			amount: 500,
			description: 'Eingang Rechnung',
			balance_after: 1500
		}
	]
}

describe('tx fan-out', () => {
	test('normalizes transactions and every tx validates against TX_SCHEMA', () => {
		const txs = bankStatementToTransactions(STATEMENT, 'value-1')
		expect(txs.length).toBe(3)
		for (const t of txs) {
			const ok = validateTx(t)
			if (!ok) console.error(t, validateTx.errors)
			expect(ok).toBe(true)
			expect(typeof t.dedup_key).toBe('string')
			expect(t.account_iban).toBe('DE12345678901234567890')
			expect(t.source_value_id).toBe('value-1')
		}
		// transaction_id wins for the keyed row
		expect(txs[1].dedup_key).toBe('tid:TX-77')
	})

	test('dedup_key is deterministic for the same input', () => {
		const a = bankStatementToTransactions(STATEMENT)
		const b = bankStatementToTransactions(STATEMENT)
		expect(a.map((t) => t.dedup_key)).toEqual(b.map((t) => t.dedup_key))
	})

	test('newTransactions is idempotent', () => {
		const txs = bankStatementToTransactions(STATEMENT)
		// First pass against an empty store: the two identical rows collapse → 2 unique.
		const firstPass = newTransactions(txs, new Set<string>())
		expect(firstPass.length).toBe(2)
		// Second pass against a store that already has those keys → nothing new.
		const have = new Set(firstPass.map((t) => t.dedup_key))
		const secondPass = newTransactions(txs, have)
		expect(secondPass.length).toBe(0)
	})
})
