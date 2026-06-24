import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import bankStatementDoctype from '../src/vibes/bank-statement/doctype.json'
import { mapBankStatementToView } from '../src/vibes/bank-statement/mapper.js'
import contractDoctype from '../src/vibes/contract/doctype.json'
import { mapContractToView } from '../src/vibes/contract/mapper.js'
import invoiceDoctype from '../src/vibes/invoice/doctype.json'
import { mapInvoiceToView } from '../src/vibes/invoice/mapper.js'

// board 0064 — proves the storage contract: a representative extracted value for each doctype
// validates against that doctype's JSON Schema (the same Ajv the /api/data store uses), and the
// per-type mapper turns it into a non-empty DocView. The build metric reads this test's exit code.

const ajv = new Ajv({ allErrors: true, strict: false })

const SAMPLES = {
	invoice: {
		doctype: invoiceDoctype,
		map: mapInvoiceToView,
		value: {
			vendor: { name: 'TechSupply GmbH', city: 'München' },
			buyer: { name: 'Acme Consulting AG' },
			header: { document_kind: 'invoice', currency: 'EUR', invoice_number: 'R-2026-1842' },
			totals: { invoice_total: 4403, tax_total: 703 },
			payments: [{ amount: 2000, method: 'Überweisung' }],
			total_outstanding: 2403,
			statements: [
				{
					section_title: 'Services',
					line_items: [
						{ description: 'Platform subscription', amount: 890, quantity: 1, tax_rate_percent: 19 }
					]
				}
			]
		}
	},
	bank_statement: {
		doctype: bankStatementDoctype,
		map: mapBankStatementToView,
		value: {
			statement_kind: 'periodic_account_statement',
			currency: 'EUR',
			account_holder: { name: 'Acme Consulting AG' },
			institution: { name: 'Musterbank AG' },
			account_overview: { iban: 'DE12 3456 7890 1234 5678 90', bic: 'ABCDDEFFXXX' },
			period_start: '2026-04-01',
			period_end: '2026-04-30',
			opening_balance: 1000,
			closing_balance: 1500,
			transactions: [
				{ description: 'Eingang Rechnung', amount: 500, booking_date: '2026-04-20', balance_after: 1500 }
			]
		}
	},
	contract: {
		doctype: contractDoctype,
		map: mapContractToView,
		value: {
			title: 'Rahmenvertrag über digitale Dienstleistungen',
			contract_type: 'Dienstleistungsvertrag',
			effective_date: '2026-05-01',
			parties: [
				{ role: 'Auftragnehmerin', name: 'Aven Labs GmbH' },
				{ role: 'Auftraggeber', name: 'Nordlicht Retail AG' }
			],
			clauses: [{ number: '§ 1', title: 'Gegenstand', body: 'Die Auftragnehmerin stellt …' }]
		}
	}
} as const

describe('doc extract — schema validation + mapping', () => {
	for (const [type, s] of Object.entries(SAMPLES)) {
		test(`${type}: sample value validates against its doctype schema`, () => {
			const validate = ajv.compile((s.doctype as { schema: object }).schema)
			const ok = validate(s.value)
			if (!ok) console.error(type, validate.errors)
			expect(ok).toBe(true)
		})

		test(`${type}: mapper produces a non-empty DocView`, () => {
			const view = s.map(s.value)
			expect(typeof view.title).toBe('string')
			expect(Array.isArray(view.sections)).toBe(true)
			expect(view.sections.length).toBeGreaterThan(0)
		})
	}
})
