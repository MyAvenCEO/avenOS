import type { SourceEntry, SourceText } from './source-retrieval'
export interface IndexedSource extends SourceEntry {
	complete: boolean
	generated?: boolean
	textArtifactId?: string
	scopeTokens: string[]
	tokens: string[]
	version?: string
}
export const sourceTokens = (s: string) => [
	...new Set(
		(
			s
				.normalize('NFKD')
				.replace(/\p{M}/gu, '')
				.toLowerCase()
				.match(/[\p{L}\p{N}]+(?:[-:][\p{L}\p{N}]+)*/gu) ?? []
		).flatMap((t) => [t, ...t.split(/[-:]/)])
	)
]
export interface SourceIndex {
	put(entry: SourceEntry, text: SourceText): Promise<void>
	remove(id: string): Promise<void>
	search(args: Record<string, unknown>): Promise<Record<string, unknown>>
	close(): void
}

const done = (t: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		t.oncomplete = () => resolve()
		t.onerror = () => reject(t.error)
		t.onabort = () => reject(t.error)
	})
/** Rebuildable disk index. Token seeks and primary-key pagination; no corpus scan on a query. */
export class DiskSourceIndex implements SourceIndex {
	readonly #db: Promise<IDBDatabase>
	#generation = 0
	readonly #epoch = crypto.randomUUID()
	#closed = false
	constructor(
		readonly name: string,
		readonly visible: (id: string) => boolean = () => true,
		readonly persistent = false
	) {
		this.#db = new Promise((resolve, reject) => {
			const open = indexedDB.open(name, 1)
			let expired = false
			const timeout = setTimeout(() => {
				expired = true
				reject(
					Error(
						'The local search index did not open. Source records remain available through their exact IDs.'
					)
				)
			}, 10_000)
			open.onblocked = () => {
				expired = true
				clearTimeout(timeout)
				reject(Error('Another window is blocking the local search index. Close it and retry.'))
			}
			open.onupgradeneeded = () => {
				open.result.createObjectStore('texts')
				open.result.createObjectStore('headers', { keyPath: 'artifactId' })
				const s = open.result.createObjectStore('sources', { keyPath: 'artifactId' })
				s.createIndex('tokens', 'tokens', { multiEntry: true })
				s.createIndex('scopeTokens', 'scopeTokens', { multiEntry: true })
				s.createIndex('intent', 'intentId')
			}
			open.onsuccess = () => {
				clearTimeout(timeout)
				if (expired || this.#closed) {
					open.result.close()
					return
				}
				open.result.onversionchange = () => open.result.close()
				resolve(open.result)
			}
			open.onerror = () => {
				clearTimeout(timeout)
				reject(open.error)
			}
		})
		// Opening starts before the first query. Observe rejection now; queries still receive it.
		void this.#db.catch(() => {})
	}
	#write(t: IDBTransaction, entry: SourceEntry, text: SourceText, version?: string) {
		const tokens = sourceTokens(`${entry.title} ${entry.summary ?? ''} ${text.content}`)
		t.objectStore('sources').put({
			...entry,
			complete: text.complete,
			generated: text.generated,
			textArtifactId: text.textArtifactId,
			version,
			tokens,
			scopeTokens: tokens.map((token) => JSON.stringify([entry.intentId, token]))
		})
		t.objectStore('texts').put(text, entry.artifactId)
		t.objectStore('headers').put({
			...entry,
			complete: text.complete,
			generated: text.generated,
			textArtifactId: text.textArtifactId,
			version
		})
	}
	async put(entry: SourceEntry, text: SourceText, version?: string) {
		const db = await this.#db
		if (this.#closed) return
		const t = db.transaction(['sources', 'texts', 'headers'], 'readwrite'),
			completed = done(t)
		this.#write(t, entry, text, version)
		await completed
		this.#generation++
	}
	async text(id: string): Promise<SourceText | undefined> {
		const db = await this.#db
		if (this.#closed || !this.visible(id)) return undefined
		return new Promise((resolve, reject) => {
			const r = db.transaction('texts').objectStore('texts').get(id)
			r.onsuccess = () => resolve(r.result)
			r.onerror = () => reject(r.error)
		})
	}
	async hasVersion(id: string, version: string): Promise<boolean> {
		const db = await this.#db
		return new Promise((resolve, reject) => {
			const r = db.transaction('headers').objectStore('headers').get(id)
			r.onsuccess = () => resolve(r.result?.version === version && r.result?.complete === true)
			r.onerror = () => reject(r.error)
		})
	}
	async putBatch(entries: Array<{ entry: SourceEntry; text: SourceText }>) {
		const db = await this.#db
		if (this.#closed) return
		const t = db.transaction(['sources', 'texts', 'headers'], 'readwrite'),
			finished = done(t)
		for (const { entry, text } of entries) this.#write(t, entry, text)
		await finished
		this.#generation++
	}

	async remove(id: string) {
		const db = await this.#db
		if (this.#closed) return
		const t = db.transaction(['sources', 'texts', 'headers'], 'readwrite'),
			finished = done(t)
		t.objectStore('sources').delete(id)
		t.objectStore('texts').delete(id)
		t.objectStore('headers').delete(id)
		await finished
		this.#generation++
	}
	close() {
		this.#closed = true
		void this.#db
			.then((db) => {
				db.close()
				if (!this.persistent) indexedDB.deleteDatabase(this.name)
			})
			.catch(() => {})
	}
	async search(args: Record<string, unknown>) {
		if (this.#closed) return { ok: false, error: 'Index closed' }
		if (
			String(args.query ?? '').length > 500 ||
			String(args.cursor ?? '').length > 4096 ||
			String(args.intent ?? '').length > 1024
		)
			return { ok: false, error: 'Search input too long' }
		if (args.before && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.before)))
			return { ok: false, error: 'Use an ISO date cutoff' }
		const query = String(args.query ?? '').slice(0, 500),
			intent = String(args.intent ?? ''),
			before = String(args.before ?? '')
		const words = sourceTokens(query)
			.sort((a, b) => b.length - a.length)
			.slice(0, 12)
		const binding = JSON.stringify([query, intent, before, this.#epoch, this.#generation])
		let after = ''
		if (args.cursor) {
			try {
				const c = JSON.parse(String(args.cursor))
				if (c.binding !== binding || typeof c.after !== 'string') throw Error()
				after = c.after
			} catch {
				return { ok: false, error: 'Index changed or cursor invalid; restart search.' }
			}
		}
		const db = await this.#db,
			transaction = db.transaction(['sources', 'headers'], 'readonly'),
			store = transaction.objectStore('sources')
		const rows: Array<Omit<IndexedSource, 'tokens' | 'scopeTokens'>> = []
		let examined = 0,
			last = after,
			exhausted = true
		await new Promise<void>((resolve, reject) => {
			const key = words.length ? (intent ? JSON.stringify([intent, words[0]]) : words[0]) : intent
			const indexed = words.length > 0 || Boolean(intent)
			const cursor = indexed
				? store
						.index(words.length ? (intent ? 'scopeTokens' : 'tokens') : 'intent')
						.openKeyCursor(IDBKeyRange.only(key))
				: store.openKeyCursor(after ? IDBKeyRange.lowerBound(after, true) : undefined)
			cursor.onerror = () => reject(cursor.error)
			cursor.onsuccess = () => {
				const c = cursor.result
				if (!c) {
					resolve()
					return
				}
				if (indexed && after && String(c.primaryKey) <= after) {
					c.continuePrimaryKey(key, `${after}\u0000`)
					return
				}
				last = String(c.primaryKey)
				examined++
				const header = store.get(c.primaryKey)
				header.onerror = () => reject(header.error)
				header.onsuccess = () => {
					const row = header.result as IndexedSource | undefined
					if (
						row &&
						this.visible(row.artifactId) &&
						words.every((word) => row.tokens.includes(word)) &&
						(!intent || row.intentId === intent) &&
						(!before || !row.createdAt || row.createdAt.slice(0, 10) <= before)
					) {
						const { tokens: _tokens, scopeTokens: _scopeTokens, ...metadata } = row
						rows.push(metadata)
					}
					if (rows.length >= 20 || examined >= 200) {
						exhausted = false
						resolve()
						return
					}
					c.continue()
				}
			}
		})
		const hasMore = !exhausted
		const next = hasMore ? JSON.stringify({ binding, after: last }) : null
		// Load bodies only for the <=20 returned candidates, never the 200 examined rows.
		const files = await Promise.all(
			rows.map(async ({ version: _version, ...entry }) => {
				const content = (await this.text(entry.artifactId))?.content ?? ''
				const lower = content.toLowerCase()
				const tokens = sourceTokens(`${entry.title} ${entry.summary ?? ''} ${content}`)
				const hit = words.map((w) => lower.indexOf(w)).find((n) => n >= 0) ?? 0
				return {
					...entry,
					snippet: content.slice(Math.max(0, hit - 100), Math.max(0, hit - 100) + 650),
					dateUnknown: !entry.createdAt,
					matchCount: words.filter((w) => tokens.includes(w)).length
				}
			})
		)
		return {
			ok: true,
			query,
			examined,
			files: files.sort((a, b) => b.matchCount - a.matchCount),
			nextCursor: next,
			hasMore,
			matchMode: 'all-tokens',
			notice:
				'All query tokens match file metadata or indexed text. Follow nextCursor for remaining results. Read sources for content claims; titles are metadata. Unknown dates remain candidates; check source dates. Absence applies only to indexed text.'
		}
	}
}
