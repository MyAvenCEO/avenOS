import { currencyMinorDigits } from '@avenos/actors'
import type { ClientArtifactGateway } from '@avenos/artifact-store'
import {
	CSV_DETECTOR_VERSION,
	type CsvDetection,
	csvSourceDigest,
	decodeCsvText,
	parseCsv,
	validCsvIban
} from './csv'
import type { DocumentSource } from './shared'

const column = { type: 'string', minLength: 1, maxLength: 255 }
/** Named columns, never executable expressions. Omitted facts remain unknown. */
export const CSV_MAPPING_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	maxProperties: 15,
	properties: {
		delimiter: { type: 'string', maxLength: 1, enum: [',', ';'] },
		dateFormat: {
			type: 'string',
			maxLength: 10,
			enum: ['YYYY-MM-DD', 'DD.MM.YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY']
		},
		decimalSeparator: { type: 'string', maxLength: 1, enum: ['.', ','] },
		groupSeparator: { type: 'string', maxLength: 1, enum: ['.', ',', ' ', "'"] },
		amountSign: { type: 'string', maxLength: 16, enum: ['account-signed', 'expense-positive'] },
		amount: column,
		currency: column,
		description: column,
		bookingDate: column,
		valueDate: column,
		transactionId: column,
		counterpartyName: column,
		counterpartyIban: column,
		accountIban: column,
		ignoredColumns: { type: 'array', maxItems: 64, items: column }
	},
	required: [
		'delimiter',
		'dateFormat',
		'decimalSeparator',
		'amountSign',
		'amount',
		'currency',
		'description',
		'ignoredColumns'
	]
} as const

export interface CsvMapping {
	delimiter: ',' | ';'
	dateFormat: 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'DD/MM/YYYY'
	decimalSeparator: '.' | ','
	groupSeparator?: '.' | ',' | ' ' | "'"
	amountSign: 'account-signed' | 'expense-positive'
	amount: string
	currency: string
	description: string
	bookingDate?: string
	valueDate?: string
	transactionId?: string
	counterpartyName?: string
	counterpartyIban?: string
	accountIban?: string
	ignoredColumns: string[]
}

/** Read the exact producer settings, never infer a mapping from explanatory prose. */
export async function readCsvMapping(
	gateway: ClientArtifactGateway,
	publicationId: string,
	detectionArtifactId: string
): Promise<CsvMapping> {
	const run = await gateway.lookup?.(publicationId)
	const output = run?.receipt.artifacts.find((item) => item.artifactId === detectionArtifactId)
	if (
		!run ||
		run.receipt.publicationId !== publicationId ||
		run.procedureKey !== 'client.map-csv-statement' ||
		!output ||
		!run.artifacts.some(
			(item) =>
				item.localKey === output.localKey &&
				item.typeKey === 'banking.csv-statement-detection' &&
				item.typeVersion === 1
		)
	)
		throw Error('Die gespeicherte Spaltenzuordnung konnte nicht geprüft werden.')
	if (run.procedureVersion === 'studio-1')
		return parseCsvMapping(
			(run.parameters.settings as Record<string, unknown> | undefined)?.mapping
		)
	if (run.procedureVersion === 'client-v1') return parseCsvMapping(run.parameters.mapping)
	throw Error('Unbekannter CSV-Verarbeitungsvertrag.')
}

export function parseCsvMapping(value: unknown): CsvMapping {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw Error('A column mapping object is required.')
	const m = value as Record<string, unknown>
	for (const key of Object.keys(m))
		if (!Object.hasOwn(CSV_MAPPING_SCHEMA.properties, key))
			throw Error(`Unknown mapping field: ${key}`)
	for (const key of CSV_MAPPING_SCHEMA.required)
		if (!Object.hasOwn(m, key)) throw Error(`Missing mapping field: ${key}`)
	for (const [key, schema] of Object.entries(CSV_MAPPING_SCHEMA.properties)) {
		if (!Object.hasOwn(m, key)) continue
		if (key === 'ignoredColumns') {
			if (
				!Array.isArray(m[key]) ||
				m[key].length > 64 ||
				m[key].some((v) => typeof v !== 'string' || !v.trim() || v.length > 255) ||
				new Set(m[key]).size !== m[key].length
			)
				throw Error('Invalid ignored columns.')
		} else if (
			typeof m[key] !== 'string' ||
			(m[key] as string).length > 255 ||
			('enum' in schema
				? !(schema.enum as readonly unknown[]).includes(m[key])
				: !(m[key] as string).trim())
		)
			throw Error(`Invalid mapping field: ${key}`)
	}
	if (m.groupSeparator === m.decimalSeparator)
		throw Error('Decimal and grouping separators must differ.')
	return m as unknown as CsvMapping
}

function mappedDate(raw: string | null, format: CsvMapping['dateFormat']): string | null {
	if (raw === null || raw === '') return null
	let iso = raw
	if (format !== 'YYYY-MM-DD') {
		const separator = format === 'DD.MM.YYYY' ? '.' : '/'
		const parts = raw.split(separator)
		if (
			parts.length !== 3 ||
			!/^\d{2}$/.test(parts[0]!) ||
			!/^\d{2}$/.test(parts[1]!) ||
			!/^\d{4}$/.test(parts[2]!)
		)
			throw Error('Date does not match the explicit format.')
		iso = `${parts[2]}-${parts[format === 'MM/DD/YYYY' ? 0 : 1]}-${parts[format === 'MM/DD/YYYY' ? 1 : 0]}`
	}
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
		!Number.isFinite(Date.parse(iso)) ||
		new Date(iso).toISOString().slice(0, 10) !== iso
	)
		throw Error('Invalid calendar date.')
	return iso
}

function mappedMoney(raw: string, currency: string, mapping: CsvMapping): number {
	const digits = currencyMinorDigits(currency)
	if (digits === null) throw Error('Unsupported currency scale.')
	const parts = raw.split(mapping.decimalSeparator)
	let integer = parts[0]!
	if (mapping.groupSeparator && integer.includes(mapping.groupSeparator)) {
		const groups = integer.replace(/^[+-]/, '').split(mapping.groupSeparator)
		if (!/^\d{1,3}$/.test(groups[0]!) || groups.slice(1).some((g) => !/^\d{3}$/.test(g)))
			throw Error('Invalid digit grouping.')
		integer = integer.split(mapping.groupSeparator).join('')
	}
	if (
		parts.length > 2 ||
		!/^[+-]?\d+$/.test(integer) ||
		(parts.length === 2 && (!/^\d+$/.test(parts[1]!) || parts[1]!.length !== digits))
	)
		throw Error(
			'Ambiguous amount: set explicit decimal/grouping conventions; rounding is not supported.'
		)
	const negative = raw.startsWith('-')
	const major = integer.replace(/^[+-]/, '')
	if (major.length > 16) throw Error('Amount exceeds exact integer range.')
	let minor = BigInt(major) * 10n ** BigInt(digits) + BigInt(parts[1] ?? '0')
	if (negative) minor = -minor
	if (mapping.amountSign === 'expense-positive') minor = -minor
	if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER))
		throw Error('Amount exceeds exact integer range.')
	return Number(minor)
}

function checkedIban(raw: string | null): string | null {
	if (!raw) return null
	const iban = raw.replace(/\s/g, '').toUpperCase()
	if (!validCsvIban(iban)) throw Error('Invalid IBAN or checksum.')
	return iban
}

/** Maps all records or rejects the entire file. No model-generated transaction values. */
export async function mapCsvStatement(
	source: DocumentSource,
	value: unknown
): Promise<CsvDetection> {
	const mapping = parseCsvMapping(value)
	const result: CsvDetection = {
		sourceArtifactId: source.artifactId,
		sourceSha256: await csvSourceDigest(source),
		detectorVersion: CSV_DETECTOR_VERSION,
		profile: 'explicit-column-mapping',
		eligible: false,
		statement: null,
		reason: ''
	}
	try {
		const rows = parseCsv(
			decodeCsvText(Uint8Array.from(atob(source.base64), (c) => c.charCodeAt(0))),
			mapping.delimiter
		)
		const headers = rows[0]!
		if (!headers || headers.some((h) => !h.trim()) || new Set(headers).size !== headers.length)
			throw Error('Unique, non-empty column headers are required.')
		if (rows.length < 2) throw Error('No transaction rows.')
		const fields = [
			'amount',
			'currency',
			'description',
			'bookingDate',
			'valueDate',
			'transactionId',
			'counterpartyName',
			'counterpartyIban',
			'accountIban'
		] as const
		const used = fields.flatMap((f) => (mapping[f] ? [mapping[f]!] : []))
		if (new Set(used).size !== used.length)
			throw Error('A source column must not be assigned different meanings.')
		if (
			[...used, ...mapping.ignoredColumns].some((h) => !headers.includes(h)) ||
			mapping.ignoredColumns.some((h) => used.includes(h)) ||
			headers.some((h) => !used.includes(h) && !mapping.ignoredColumns.includes(h))
		)
			throw Error(
				'Every column must be mapped or explicitly acknowledged as ignored; the saved layout does not match.'
			)
		let currency: string | undefined, account: string | null | undefined
		const ids = new Set<string>()
		const transactions = rows.slice(1).map((row, i) => {
			try {
				if (row.length !== headers.length) throw Error('Row width differs from the header.')
				const cell = (field: (typeof fields)[number]) =>
					mapping[field] ? row[headers.indexOf(mapping[field]!)]!.trim() : null
				const c = cell('currency')!
				if (!/^[A-Z]{3}$/.test(c) || (currency && currency !== c))
					throw Error('A single explicit currency is required; split mixed-currency files first.')
				currency = c
				const own = checkedIban(cell('accountIban'))
				if (account !== undefined && own !== account)
					throw Error('Multiple accounts require separate statements.')
				account = own
				const description = cell('description')!
				if (!description || description.length > 4000)
					throw Error('A bounded payment description is required.')
				const name = cell('counterpartyName'),
					id = cell('transactionId')
				if (name && name.length > 512) throw Error('Counterparty name is too long.')
				if (id && (id.length > 255 || ids.has(id)))
					throw Error('Invalid or repeated transaction identifier.')
				if (id) ids.add(id)
				return {
					transactionId: id || null,
					bookingDate: mappedDate(cell('bookingDate'), mapping.dateFormat),
					valueDate: mappedDate(cell('valueDate'), mapping.dateFormat),
					title: null,
					amountMinor: mappedMoney(cell('amount')!, c, mapping),
					counterpartyName: name || null,
					counterpartyIban: checkedIban(cell('counterpartyIban')),
					description,
					originalAmountMinor: null,
					originalCurrency: null,
					exchangeRate: null,
					fxSurchargeMinor: null,
					foreignExchangeFeeBps: null,
					balanceAfterMinor: null,
					sourceRow: i + 2
				}
			} catch (e) {
				throw Error(`Record ${i + 2}: ${e instanceof Error ? e.message : String(e)}`)
			}
		})
		result.statement = {
			statementKind: 'transaction-overview',
			currency,
			accountHolder: null,
			accountHolderAddress: null,
			accountHolderDetails: null,
			institution: null,
			accountIban: account,
			accountBic: null,
			accountNumber: null,
			productName: null,
			openingBalanceMinor: null,
			closingBalanceMinor: null,
			periodStart: null,
			periodEnd: null,
			transactions,
			notes: `Mapping: amount ← ${mapping.amount}; currency ← ${mapping.currency}; description ← ${mapping.description}; booking date ← ${mapping.bookingDate ?? '(unknown)'}; value date ← ${mapping.valueDate ?? '(unknown)'}. Date format: ${mapping.dateFormat}; decimal separator: ${mapping.decimalSeparator}; grouping separator: ${mapping.groupSeparator === ' ' ? '(space)' : (mapping.groupSeparator ?? '(none)')}; sign convention: ${mapping.amountSign}. ${mapping.ignoredColumns.length} ignored columns; exact settings are retained in production provenance. No proof of settlement, authenticity, account ownership or full-period coverage.`,
			summary: `${transactions.length} mapped CSV rows. Review column meanings, dates, currency and debit/credit sign before confirmation.`
		}
		result.eligible = true
		result.reason =
			'Every row passed the explicit mapping. Human review of column meanings and document type is still required.'
	} catch (e) {
		result.reason = (e instanceof Error ? e.message : String(e)).slice(0, 1000)
	}
	return result
}
