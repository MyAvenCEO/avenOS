import { expect, test } from 'bun:test'
import { cellValue, type LibraryRow, rowArtifactId } from '../src/lib/artifacts/library'

const row = (data: Record<string, unknown>) => ({ data }) as LibraryRow

test('financial cells preserve zero, missing values and recorded currency', () => {
	expect(
		cellValue(row({ grossMinor: 0, currency: 'EUR' }), {
			key: 'grossMinor',
			label: 'Total',
			money: true
		})
	).toBe('0,00 EUR')
	expect(
		cellValue(row({ grossMinor: null, currency: 'EUR' }), {
			key: 'grossMinor',
			label: 'Total',
			money: true
		})
	).toBe('—')
	expect(
		cellValue(row({ grossMinor: -1250, currency: 'USD' }), {
			key: 'grossMinor',
			label: 'Total',
			money: true
		})
	).toBe('-12,50 USD')
})

test('a financial table row opens its exact representation for Studio', () => {
	const document = {
		artifactType: 'bookkeeping.invoice-details',
		source: { artifactId: 'source-id' },
		representations: [
			{ typeKey: 'bookkeeping.invoice-validation', artifactId: 'validation-id' },
			{ typeKey: 'bookkeeping.invoice-details', artifactId: 'details-id' }
		]
	} as LibraryRow
	expect(rowArtifactId(document)).toBe('details-id')
})
