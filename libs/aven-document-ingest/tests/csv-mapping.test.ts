import { newStudioSkillV2, parseStudioSkillV2 } from '@avenos/actors'
import { expect, test } from 'vitest'
import {
	CSV_STATEMENT_MAPPER_MANIFEST,
	createCsvStatementMapperActor
} from '../src/actors/csv-statement-mapper'
import { createDocumentActors } from '../src/actors/registry'
import { decodeCsvText } from '../src/csv'
import { confirmCsvStatement } from '../src/csv-confirmation'
import { type CsvMapping, mapCsvStatement, readCsvMapping } from '../src/csv-mapping'
import { ServerDocumentDecoder } from '../src/server'
import { CsvMemoryGateway } from './support/csv-corpus'

const mapping: CsvMapping = {
	delimiter: ';',
	dateFormat: 'DD.MM.YYYY',
	decimalSeparator: ',',
	amountSign: 'account-signed',
	amount: 'Betrag',
	currency: 'Waehrung',
	description: 'Text/Verwendungszweck',
	ignoredColumns: ['Kartennummer', 'Zeitraum', 'Belegdatum', 'Kurs'],
	bookingDate: 'Eingangstag'
}
const header =
	'Kartennummer;Zeitraum;Belegdatum;Eingangstag;Text/Verwendungszweck;Kurs;Betrag;Waehrung'
const text =
	header +
	'\r\nTEST-CARD-0000;2026/06;11.05.2026;13.05.2026;Bürobedarf;;-19,95;EUR\r\nTEST-CARD-0000;2026/06;12.05.2026;14.05.2026;Erstattung;;5,00;EUR\r\n'
const source = (s = text) => ({
	artifactId: '11111111-1111-4111-8111-111111111111',
	originalName: 'bank.csv',
	declaredMediaType: 'text/csv',
	base64: Buffer.from(s, 'utf16le').toString('base64')
})

test('UTF-16 LE/BE, BOM and no BOM, decode without corrupting text; odd bytes fail', () => {
	for (const bom of ['', '\ufeff']) {
		const le = Buffer.from(bom + text, 'utf16le'),
			be = Buffer.from(le).swap16()
		expect(decodeCsvText(le)).toBe(text)
		expect(decodeCsvText(be)).toBe(text)
		expect(() => decodeCsvText(le.subarray(0, le.length - 1))).toThrow()
	}
	expect(() => decodeCsvText(new TextEncoder().encode('a,b\n1,\0'))).toThrow()
})

test('mapping uses exact amounts and dates, retains unknowns and source record numbers', async () => {
	const d = await mapCsvStatement(source(), mapping)
	expect(d.eligible, d.reason).toBe(true)
	expect(d.statement).toMatchObject({
		currency: 'EUR',
		accountIban: null,
		accountNumber: null,
		periodStart: null,
		periodEnd: null
	})
	expect(d.statement!.transactions).toMatchObject([
		{
			amountMinor: -1995,
			bookingDate: '2026-05-13',
			valueDate: null,
			counterpartyName: null,
			sourceRow: 2
		},
		{ amountMinor: 500, sourceRow: 3 }
	])
	const reversed = await mapCsvStatement(source(), { ...mapping, amountSign: 'expense-positive' })
	expect((reversed.statement!.transactions as any[]).map((t) => t.amountMinor)).toEqual([
		1995, -500
	])
})

for (const [name, mutate] of Object.entries({
	'mixed currency': (s: string) => s.replace('5,00;EUR', '5,00;USD'),
	'invalid date': (s: string) => s.replace('13.05.2026', '31.02.2026'),
	'wrong decimal convention': (s: string) => s.replace('-19,95', '-19.95'),
	'grouped amount': (s: string) => s.replace('-19,95', '-1.019,95'),
	'unsafe amount': (s: string) => s.replace('-19,95', '-9007199254740992,00'),
	'extra column': (s: string) => s.replace(header, header + ';Other'),
	'duplicate column': (s: string) => s.replace('Kurs;', 'Betrag;'),
	'blank description': (s: string) => s.replace('Bürobedarf', ''),
	'partial record': (s: string) => s + 'broken\n',
	'row limit': (s: string) => s + Array(128).fill(s.split('\r\n')[1]).join('\r\n')
}))
	test(`rejects whole file: ${name}`, async () => {
		const d = await mapCsvStatement(source(mutate(text)), mapping)
		expect(d.eligible).toBe(false)
		expect(d.statement).toBeNull()
	})

test('mapping settings are closed, column coverage exact, and semantic aliases rejected', async () => {
	await expect(mapCsvStatement(source(), { ...mapping, script: 'delete all' })).rejects.toThrow()
	for (const change of [
		{ ignoredColumns: [] },
		{ amount: 'missing' },
		{ valueDate: 'Eingangstag' }
	])
		expect((await mapCsvStatement(source(), { ...mapping, ...change })).eligible).toBe(false)
})

test('currency scale is applied exactly, never assumed to be cents', async () => {
	for (const [currency, amount, expected] of [
		['JPY', '123', 123],
		['KWD', '1,234', 1234]
	] as const) {
		const s = header + `\nxxxx;2026/06;11.05.2026;13.05.2026;Purchase;;${amount};${currency}`
		const d = await mapCsvStatement(source(s), mapping)
		expect(d.eligible, d.reason).toBe(true)
		expect((d.statement!.transactions as any[])[0].amountMinor).toBe(expected)
	}
})

test('grouping is explicit and strict, including spaces', async () => {
	for (const groupSeparator of ['.', ' ', "'"] as const) {
		const valid = await mapCsvStatement(
			source(text.replace('-19,95', `-1${groupSeparator}019,95`)),
			{ ...mapping, groupSeparator }
		)
		expect(valid.eligible, valid.reason).toBe(true)
		expect((valid.statement!.transactions as any[])[0].amountMinor).toBe(-101995)
		const bad = await mapCsvStatement(source(text.replace('-19,95', `-10${groupSeparator}19,95`)), {
			...mapping,
			groupSeparator
		})
		expect(bad.eligible).toBe(false)
	}
})

test('IBANs retain their checksum, and mapping objects reject prototype keys', async () => {
	const options = {
		...mapping,
		accountIban: 'Kartennummer',
		ignoredColumns: mapping.ignoredColumns.filter((c) => c !== 'Kartennummer')
	}
	const valid = await mapCsvStatement(
		source(text.replaceAll('TEST-CARD-0000', 'DE89 3704 0044 0532 0130 00')),
		options
	)
	expect(valid.eligible, valid.reason).toBe(true)
	expect(valid.statement!.accountIban).toBe('DE89370400440532013000')
	expect(
		(
			await mapCsvStatement(
				source(text.replaceAll('TEST-CARD-0000', 'DE88370400440532013000')),
				options
			)
		).eligible
	).toBe(false)
	for (const key of ['constructor', '__proto__', 'prototype']) {
		await expect(mapCsvStatement(source(), { ...mapping, [key]: 'bad' })).rejects.toThrow(
			'Unknown mapping field'
		)
	}
})

test('mapper is a registered Actor with a Studio-compatible parameter schema', async () => {
	const actors = createDocumentActors(new ServerDocumentDecoder())
	expect(actors.all.some((a) => a.manifest.id === 'csv-statement-mapper')).toBe(true)
	const definition = newStudioSkillV2('Mapped bank file')
	definition.parametersSchema = CSV_STATEMENT_MAPPER_MANIFEST.methods[0]!.parameters
	expect(() => parseStudioSkillV2(definition)).not.toThrow()
	const actor = createCsvStatementMapperActor()
	const result = JSON.parse(
		(await actor.deliver('document_map_csv_statement', { source: source(), mapping })).record
	)
	expect(result.ok).toBe(true)
	expect(result.artifacts[0].payload.eligible).toBe(true)
	expect(result.evidence[0].inputRole).toBe('source')
	actor.dispose()
	for (const a of actors.all) a.dispose()
})

test('human approvals of different mapping revisions cannot alias', async () => {
	const d = await mapCsvStatement(source(), mapping),
		store = new CsvMemoryGateway()
	const first = await confirmCsvStatement(
		store,
		'22222222-2222-4222-8222-222222222222',
		d,
		'accepted'
	)
	const second = await confirmCsvStatement(
		store,
		'33333333-3333-4333-8333-333333333333',
		d,
		'accepted'
	)
	expect(first).not.toBe(second)
})

test('review reads only the exact typed producer mapping in either execution lane', async () => {
	const store = new CsvMemoryGateway()
	const payload = await mapCsvStatement(source(), mapping)
	const receipt = await store.publish({
		publicationId: store.uuid(),
		procedureKey: 'client.map-csv-statement',
		procedureVersion: 'client-v1',
		inputs: [],
		parameters: { mapping },
		evidence: [],
		artifacts: [
			{
				localKey: 'detection',
				typeKey: 'banking.csv-statement-detection',
				typeVersion: 1,
				payload,
				output: { role: 'detection', ordinal: 0 }
			}
		]
	})
	const id = receipt.artifacts[0]!.artifactId
	expect(await readCsvMapping(store, receipt.publicationId, id)).toEqual(mapping)
	const run = store.committed.get(receipt.publicationId)!
	run.procedureVersion = 'studio-1'
	run.parameters = { settings: { mapping } }
	expect(await readCsvMapping(store, receipt.publicationId, id)).toEqual(mapping)
	await expect(readCsvMapping(store, receipt.publicationId, store.uuid())).rejects.toThrow()
	await expect(readCsvMapping(store, store.uuid(), id)).rejects.toThrow()
	run.procedureKey = 'client.some-other-procedure'
	await expect(readCsvMapping(store, receipt.publicationId, id)).rejects.toThrow()
	run.procedureKey = 'client.map-csv-statement'
	run.parameters = {}
	await expect(readCsvMapping(store, receipt.publicationId, id)).rejects.toThrow()
})
