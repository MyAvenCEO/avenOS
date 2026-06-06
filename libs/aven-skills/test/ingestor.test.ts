import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import rawConfig from '../configs/victorio-pos-orders.json'
import {
	createIngestor,
	type IngestConfig,
	type SourceRef,
	textSource,
	type UploaderPort
} from '../src/index'

const config = rawConfig as IngestConfig

function fixture(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8')
}

interface Order {
	id: number
	invoiceNo: string
	location: string
	server: string
	cashier: string
	orderedAt: string
	paidAt: string | null
	status: string
	lines: OrderLine[]
	_source: SourceRef
}
interface OrderLine {
	lineId: number
	positionId: number
	product: string
	category: string
	vat: string
	price: number
	qty: number
	note?: string | null
	toGo?: boolean
	_source: SourceRef
}

const base = () => textSource('sample-pos.csv', fixture('sample-pos.csv'))

describe('victorio POS ingest', () => {
	test('extracts the source schema (columns)', async () => {
		const ing = createIngestor(config)
		const report = await ing.ingest(base())
		// 15 columns in the export header.
		expect(report.duplicateFile).toBe(false)
		const orders = report.output.orders as unknown as Order[]
		expect(orders).toHaveLength(2)
	})

	test('groups flat rows into nested orders with lines', async () => {
		const ing = createIngestor(config)
		const report = await ing.ingest(base())
		const orders = (report.output.orders as unknown as Order[]).sort((a, b) => a.id - b.id)

		const o12 = orders.find((o) => o.id === 20612)
		const o13 = orders.find((o) => o.id === 20613)
		expect(o13?.lines).toHaveLength(4)
		expect(o12?.lines).toHaveLength(3)

		// Non-obvious column mapping proves the config does real work.
		expect(o13?.location).toBe('Service 2')
		expect(o13?.server).toBe('Mitarbeiter')
		expect(o13?.cashier).toBe('Service 1')
		expect(o13?.status).toBe('paid')

		// Coercions: German date → ISO, German decimal → number, positionId from ID Bestellposition.
		expect(o13?.orderedAt).toBe('2026-05-30T22:46:14')
		expect(o13?.paidAt).toBe('2026-05-30T23:37:06')
		const helles = o13?.lines.find((l) => l.positionId === 43643)
		expect(helles?.lineId).toBe(40890)
		// lineId (ID Bezahlposition) is unique per source row — the safe render key.
		const lineIds = (o13?.lines ?? []).map((l) => l.lineId)
		expect(new Set(lineIds).size).toBe(lineIds.length)
		expect(helles?.price).toBeCloseTo(4.9, 5)
		expect(helles?.qty).toBe(1)
		expect(helles?.category).toBe('Bier')
		expect(helles?.toGo).toBe(false)

		// To-Go "Ja" → true on the Pommes line in order 20612.
		const pommes = o12?.lines.find((l) => l.positionId === 43636)
		expect(pommes?.toGo).toBe(true)
	})

	test('every target row carries source provenance', async () => {
		const ing = createIngestor(config)
		const report = await ing.ingest(base())
		const orders = report.output.orders as unknown as Order[]
		for (const o of orders) {
			expect(o._source.fileId).toBe(report.fileId)
			expect(o._source.contentSha256).toBe(report.contentSha256)
			expect(o._source.ingestId).toBe(report.runId)
			expect(typeof o._source.sourceRef).toBe('string')
			for (const l of o.lines) {
				expect(l._source.contentSha256).toBe(report.contentSha256)
				expect(l._source.sourceRef).not.toBe('')
			}
		}
	})

	test('re-ingesting the same file is a no-op (file-level idempotency)', async () => {
		const ing = createIngestor(config)
		const first = await ing.ingest(base())
		const second = await ing.ingest(base())
		expect(first.stats.orders.added).toBe(2)
		expect(second.duplicateFile).toBe(true)
		expect(second.stats.orders.added).toBe(0)
		expect(second.stats.order_lines.added).toBe(0)
		// Output is unchanged — no duplicates introduced.
		expect((second.output.orders as unknown[]).length).toBe(2)
	})

	test('row-level dedup when file-level skip is disabled', async () => {
		const ing = createIngestor({ ...config, skipDuplicateFiles: false })
		const first = await ing.ingest(base())
		const second = await ing.ingest(base())
		expect(first.stats.order_lines.added).toBe(7)
		expect(second.duplicateFile).toBe(false)
		expect(second.stats.order_lines.added).toBe(0)
		expect(second.stats.order_lines.skipped).toBe(7)
		expect((second.output.orders as unknown[]).length).toBe(2)
	})

	test('a superset file only adds the genuinely new rows', async () => {
		const ing = createIngestor(config)
		await ing.ingest(base())
		const sup = await ing.ingest(textSource('sup.csv', fixture('sample-pos-superset.csv')))
		// +1 order key (20615); orders dedup is per source row, so the other 8 rows skip.
		expect(sup.stats.orders.added).toBe(1)
		expect(sup.stats.orders.skipped).toBe(8)
		expect(sup.stats.order_lines.added).toBe(2)
		expect(sup.stats.order_lines.skipped).toBe(7)
		expect((sup.output.orders as unknown[]).length).toBe(3)
	})

	test('uses the injected uploader port for the source doc', async () => {
		const uploads: string[] = []
		const uploader: UploaderPort = {
			async upload({ filename, contentSha256 }) {
				uploads.push(filename)
				return { fileId: `groove:${contentSha256.slice(0, 8)}` }
			}
		}
		const ing = createIngestor(config, { ports: { uploader } })
		const report = await ing.ingest(base())
		expect(uploads).toEqual(['sample-pos.csv'])
		expect(report.fileId.startsWith('groove:')).toBe(true)
		const orders = report.output.orders as unknown as Order[]
		expect(orders[0]._source.fileId).toBe(report.fileId)
	})

	test('auto-detects a tab-delimited source', async () => {
		const cols = [
			'Id;Rechnungs-Nr;Bezahldatum;ID Bestellung;ID Bestellposition;Bestelldatum',
			'Ort;Nach;Mitarbeiter;ID Bezahlposition;Produktname;Kategorie;MwSt;Preis;Anzahl'
		]
			.join(';')
			.split(';')
		const vals = [
			'8836;#008836;30.05.2026 23:37:06;20613;43643;30.05.2026 22:46:14',
			'Service 2;Mitarbeiter;Service 1;40890;Helles 0,5l;Bier;19 %;4,90;1'
		]
			.join(';')
			.split(';')
		const tab = `${cols.join('\t')}\n${vals.join('\t')}`
		const ing = createIngestor(config)
		const r = await ing.ingest(textSource('tab.csv', tab))
		const orders = r.output.orders as unknown as Order[]
		expect(orders).toHaveLength(1)
		expect(orders[0].lines[0].price).toBeCloseTo(4.9, 5)
	})

	test('emits stage lifecycle events in pipeline order', async () => {
		const done: string[] = []
		const ing = createIngestor(config, {
			onStageEvent: (e) => {
				if (e.phase === 'done') done.push(e.stage)
			}
		})
		await ing.ingest(base())
		expect(done).toEqual(['ingest', 'parse', 'transform', 'dedup', 'assemble'])
	})
})
