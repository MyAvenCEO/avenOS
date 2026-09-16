import 'fake-indexeddb/auto'
import { afterEach, expect, test } from 'bun:test'
import { SourceCatalog } from '../src/lib/intents/source-catalog'
import { DiskSourceIndex } from '../src/lib/intents/source-index'
import {
	readSource,
	type SourceEntry,
	type SourceProvider,
	searchSources
} from '../src/lib/intents/source-retrieval'
import { readStoredSource } from '../src/lib/intents/stored-source'

const indexes: DiskSourceIndex[] = []
afterEach(() => {
	for (const i of indexes) i.close()
	indexes.length = 0
})
function setup() {
	const index = new DiskSourceIndex(crypto.randomUUID())
	indexes.push(index)
	const entries: SourceEntry[] = []
	const texts = new Map<string, string>()
	let reads = 0
	const provider: SourceProvider = {
		index,
		entries: () => entries,
		read: async (e) => {
			reads++
			return { content: texts.get(e.artifactId) ?? '', complete: true }
		}
	}
	return {
		index,
		entries,
		texts,
		provider,
		get reads() {
			return reads
		},
		async add(id: string, text: string, title = 'Statement') {
			const e = { artifactId: id, intentId: 'work', title, kind: 'text', createdAt: '2026-02-21' }
			entries.push(e)
			texts.set(id, text)
			await index.put(e, { content: text, complete: true })
		}
	}
}
test('indexed body search finds hidden reference without downloading any source', async () => {
	const s = setup()
	await s.add('a', 'Order MA-2026-0203. 150 EUR pending.')
	await s.add('b', 'Unrelated file')
	const result = await searchSources(s.provider, { query: 'MA-2026-0203' })
	expect((result.files as SourceEntry[]).map((e) => e.artifactId)).toEqual(['a'])
	expect(s.reads).toBe(0)
	expect(JSON.stringify(result)).not.toContain('Unrelated file')
})
test('keyset pages cover every result without skipped offsets and reject mismatched cursors', async () => {
	const s = setup()
	for (let i = 0; i < 63; i++) await s.add(String(i).padStart(3, '0'), 'refund pending')
	const ids = new Set<string>()
	let cursor: unknown
	do {
		const p = await s.index.search({ query: 'refund', cursor })
		for (const e of p.files as SourceEntry[]) ids.add(e.artifactId)
		expect(p.examined as number).toBeLessThanOrEqual(200)
		cursor = p.nextCursor
	} while (cursor)
	expect(ids.size).toBe(63)
	const p = await s.index.search({ query: 'refund' })
	expect((await s.index.search({ query: 'different', cursor: p.nextCursor })).ok).toBe(false)
	await s.index.put(s.entries[0], { content: 'changed', complete: true })
	expect((await s.index.search({ query: 'refund', cursor: p.nextCursor })).ok).toBe(false)
})
test('bad IDs and ambiguous titles never resolve to unrelated evidence; long text pages are exact', async () => {
	const s = setup()
	await s.add('qwen-one:artifact', 'x'.repeat(12001))
	await s.add('qwen-two:artifact', 'Other')
	expect((await readSource(s.provider, { artifact: 'qwen-one' })).ok).toBe(false)
	expect((await readSource(s.provider, { artifact: 'Statement' })).ok).toBe(false)
	const a = await readSource(s.provider, { artifact: 'qwen-one:artifact' })
	expect(a.nextOffset).toBe(12000)
	expect(a.content?.length).toBe(12000)
	const b = await readSource(s.provider, { artifact: 'qwen-one:artifact', offset: a.nextOffset })
	expect(b.content).toBe('x')
	expect(b.nextOffset).toBeNull()
})
test('index removes obsolete postings, scopes and date cutoffs', async () => {
	const s = setup()
	await s.add('a', 'refund')
	await s.index.put(s.entries[0], { content: 'shipment', complete: true })
	expect((await s.index.search({ query: 'refund' })).files).toEqual([])
	expect((await s.index.search({ query: 'shipment', intent: 'other' })).files).toEqual([])
	expect((await s.index.search({ query: 'shipment', before: '2026-01-01' })).files).toEqual([])
	await s.index.remove('a')
	expect((await s.index.search({ query: 'shipment' })).files).toEqual([])
})
test('background indexing has two readers at most and discards results after close', async () => {
	let running = 0,
		peak = 0
	const release: Array<() => void> = []
	const c = new SourceCatalog(async () => {
		running++
		peak = Math.max(peak, running)
		await new Promise<void>((r) => release.push(r))
		running--
		return { content: 'evidence', complete: true }
	})
	for (let i = 0; i < 20; i++)
		c.register({ artifactId: String(i), title: 'File', intentId: 'i', kind: 'text' })
	for (let i = 0; i < 100 && peak < 2; i++) await new Promise((r) => setTimeout(r, 1))
	expect(peak).toBe(2)
	expect(c.coverage().pending).toBe(20)
	c.close()
	for (const r of release) r()
	await new Promise((r) => setTimeout(r, 5))
	expect(c.entries()).toEqual([])
})
test('stored PDF text uses assembled document and preserves incomplete extraction', async () => {
	const calls: string[] = []
	const invoke = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
		calls.push(`${command}:${args.artifactId}`)
		if (command === 'artifact_get')
			return {
				payload:
					args.artifactId === 'pdf' ? { declaredMediaType: 'application/pdf' } : { complete: false }
			} as T
		if (command === 'artifact_processing_status')
			return {
				presentation: {
					derivedArtifacts: [
						{ artifactId: 'text', typeKey: 'docs.extracted-text', stageKey: 'assemble-document' }
					]
				}
			} as T
		return { mediaType: 'text/plain', base64: btoa('Invoice 150 EUR pending.') } as T
	}
	expect(await readStoredSource('pdf', invoke)).toEqual({
		content: 'Invoice 150 EUR pending.',
		complete: false,
		textArtifactId: 'text'
	})
	expect(calls).toContain('artifact_content_get:text')
	expect(calls).not.toContain('artifact_content_get:pdf')
})

test('scoped token and browse queries seek directly past unrelated records', async () => {
	const s = setup()
	await s.index.putBatch(
		Array.from({ length: 500 }, (_, n) => ({
			entry: {
				artifactId: String(n).padStart(4, '0'),
				intentId: 'other',
				title: 'Invoice',
				kind: 'text'
			},
			text: { content: 'invoice pending', complete: true }
		}))
	)
	await s.add('target', 'invoice pending')
	for (const query of ['invoice', '']) {
		const r = await s.index.search({ query, intent: 'work' })
		expect(r.examined).toBe(1)
		expect(r.files?.map((f) => f.artifactId)).toEqual(['target'])
	}
})
test('filtered searches bound examined rows and keep unknown dates explicit', async () => {
	const s = setup()
	await s.index.putBatch(
		Array.from({ length: 250 }, (_, n) => ({
			entry: {
				artifactId: String(n).padStart(4, '0'),
				intentId: 'work',
				title: 'Invoice',
				kind: 'text',
				createdAt: '2026-06-01'
			},
			text: { content: 'invoice pending', complete: true }
		}))
	)
	const r = await s.index.search({ query: 'invoice', before: '2026-02-01' })
	expect(r.examined).toBe(200)
	expect(r.files).toEqual([])
	expect(r.hasMore).toBe(true)
	await s.index.put(
		{ artifactId: 'unknown', intentId: 'work', title: 'Archive', kind: 'text' },
		{ content: 'undated record', complete: true }
	)
	const unknown = await s.index.search({ query: 'undated', before: '2026-02-01' })
	expect(unknown.files?.[0]?.dateUnknown).toBe(true)
})
test('persistent cache reopens without source downloads, isolates namespaces and invalidates versions', async () => {
	const scope = crypto.randomUUID()
	let downloads = 0
	const fetch = async () => {
		downloads++
		return { content: 'invoice pending', complete: true }
	}
	const entry = { artifactId: 'file', title: 'Invoice', kind: 'text', intentId: 'work' }
	const first = new SourceCatalog(fetch, scope)
	first.register(entry, 'v1')
	while (first.coverage().pending) await new Promise((r) => setTimeout(r, 1))
	first.close()
	const reopened = new SourceCatalog(fetch, scope)
	reopened.register(entry, 'v1')
	while (reopened.coverage().pending) await new Promise((r) => setTimeout(r, 1))
	expect(downloads).toBe(1)
	await reopened.read(entry)
	expect(downloads).toBe(1)
	expect((await searchSources(reopened, { query: 'invoice' })).coverage).toBe('partial')
	reopened.inventoryComplete = true
	expect((await searchSources(reopened, { query: 'invoice' })).coverage).toBe('indexed')
	reopened.register(entry, 'v2')
	while (reopened.coverage().pending) await new Promise((r) => setTimeout(r, 1))
	expect(downloads).toBe(2)
	const other = new SourceCatalog(fetch, crypto.randomUUID())
	expect((await other.index.search({ query: 'invoice' })).files).toEqual([])
	await reopened.removeIntent('work')
	expect(await reopened.index.text('file')).toBeUndefined()
	reopened.close()
	other.close()
	indexedDB.deleteDatabase(`aven-research-${scope}`)
	indexedDB.deleteDatabase(other.index.name)
})

test('processing progress does not fetch source text until the final projection is ready', async () => {
	let downloads = 0
	const c = new SourceCatalog(async () => {
		downloads++
		return { content: 'complete', complete: true }
	})
	const entry = { artifactId: 'file', intentId: 'work', title: 'File', kind: 'text' }
	for (let i = 0; i < 40; i++) c.register(entry, `stage-${i}`, false)
	await new Promise((r) => setTimeout(r, 5))
	expect(downloads).toBe(0)
	expect(c.coverage().pending).toBe(1)
	c.register(entry, 'final', true)
	while (c.coverage().pending) await new Promise((r) => setTimeout(r, 1))
	expect(downloads).toBe(1)
	c.close()
})

test('rate limiting pauses the background queue and retries without marking sources absent', async () => {
	let attempts = 0
	const c = new SourceCatalog(
		async () => {
			if (++attempts <= 2) throw Error('429 Too many requests')
			return { content: 'recovered', complete: true }
		},
		undefined,
		30
	)
	for (let i = 0; i < 6; i++)
		c.register({ artifactId: `f${i}`, intentId: 'work', title: 'File', kind: 'text' })
	await new Promise((r) => setTimeout(r, 10))
	expect(attempts).toBe(2)
	expect(c.coverage().pending).toBe(6)
	expect(c.coverage().unavailable).toBe(0)
	while (c.coverage().pending) await new Promise((r) => setTimeout(r, 2))
	expect(attempts).toBe(8)
	c.close()
})

test('an unavailable disk cache does not block authenticated direct source reads', async () => {
	const c = new SourceCatalog(async () => ({ content: 'original source text', complete: true }))
	c.index.hasVersion = async () => {
		throw Error('storage unavailable')
	}
	c.index.put = async () => {
		throw Error('quota exceeded')
	}
	const e = { artifactId: 'source', intentId: 'work', title: 'File', kind: 'text' }
	c.register(e, 'v1', false)
	expect((await readSource(c, { artifact: 'source' })).content).toBe('original source text')
	c.close()
})
