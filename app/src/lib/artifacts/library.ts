import type { BrowsedArtifact } from './artifact-tree'

export type Collection = 'documents' | 'invoices' | 'statements' | 'transactions' | 'line-items'

export interface LibraryRow {
	key: string
	source: BrowsedArtifact
	name: string
	mediaType: string
	sizeBytes: number | null
	category: string
	status: 'checked' | 'review' | 'unverified'
	artifactType: string
	data: Record<string, unknown>
	representations: BrowsedArtifact[]
	documentId?: string | null
}

export interface LibraryPage {
	storeEpoch: string
	snapshotSequence: number
	items: LibraryRow[]
	nextAfter: string | null
}

export interface LibraryColumn {
	key: string
	label: string
	money?: boolean
}

const column = (key: string, label: string, money = false): LibraryColumn => ({ key, label, money })

export const collections: { key: Collection; label: string; columns: LibraryColumn[] }[] = [
	{
		key: 'documents',
		label: 'Dokumente',
		columns: [column('name', 'Datei'), column('category', 'Typ'), column('date', 'Hinzugefügt')]
	},
	{
		key: 'invoices',
		label: 'Rechnungen & Belege',
		columns: [
			column('supplier', 'Lieferant'),
			column('invoiceNumber', 'Belegnummer'),
			column('issueDate', 'Datum'),
			column('grossMinor', 'Gesamt', true),
			column('dueDate', 'Fällig')
		]
	},
	{
		key: 'statements',
		label: 'Kontoauszüge',
		columns: [
			column('accountHolder', 'Kontoinhaber'),
			column('accountIban', 'IBAN'),
			column('periodStart', 'Von'),
			column('periodEnd', 'Bis'),
			column('closingBalanceMinor', 'Endsaldo', true)
		]
	},
	{
		key: 'transactions',
		label: 'Buchungen',
		columns: [
			column('bookingDate', 'Buchungstag'),
			column('counterpartyName', 'Gegenpartei'),
			column('description', 'Verwendungszweck'),
			column('amountMinor', 'Betrag', true),
			column('accountIban', 'Konto')
		]
	},
	{
		key: 'line-items',
		label: 'Positionen',
		columns: [
			column('invoiceNumber', 'Belegnummer'),
			column('description', 'Beschreibung'),
			column('quantity', 'Menge'),
			column('unitPriceMinor', 'Einzelpreis', true),
			column('netMinor', 'Netto', true),
			column('grossMinor', 'Brutto', true)
		]
	}
]

export const categories = [
	['all', 'Alle'],
	['email', 'E-Mails'],
	['invoice', 'Rechnungen'],
	['credit-note', 'Gutschriften'],
	['receipt', 'Kassenbelege'],
	['statement', 'Kontoauszüge'],
	['voucher', 'Gutscheine'],
	['contract', 'Verträge'],
	['contract-summary', 'Vertragsübersichten'],
	['transport-ticket', 'Fahrkarten'],
	['booking-confirmation', 'Buchungen'],
	['delivery-notification', 'Lieferankündigungen'],
	['other', 'Weitere'],
	['unknown', 'Noch nicht erkannt']
] as const

export function categoryLabel(key: unknown): string {
	return categories.find(([value]) => value === key)?.[1] ?? (typeof key === 'string' ? key : '—')
}

export function cellValue(row: LibraryRow, col: LibraryColumn): string {
	const value = row.data[col.key]
	if (value === undefined || value === null || value === '') return '—'
	if (col.key === 'category') return categoryLabel(value)
	if (col.key === 'date' && typeof value === 'string')
		return new Date(value).toLocaleDateString('de-DE')
	if (col.money && (typeof value === 'number' || typeof value === 'string')) {
		const number = Number(value)
		if (!Number.isFinite(number)) return String(value)
		const currency = row.data.currency
		const amount = (number / 100).toLocaleString('de-DE', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 6
		})
		return `${amount}${typeof currency === 'string' ? ` ${currency}` : ' · Währung unbekannt'}`
	}
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

export function rowArtifactId(row: LibraryRow): string {
	return (
		row.representations.find((artifact) => artifact.typeKey === row.artifactType)?.artifactId ??
		row.source.artifactId
	)
}
