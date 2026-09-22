import { DiskSourceIndex } from './source-index'
import type { SourceEntry, SourceProvider, SourceText } from './source-retrieval'
/** Incremental, bounded background indexing; queries never download source documents. */
export class SourceCatalog implements SourceProvider {
	readonly #entries = new Map<string, SourceEntry>()
	readonly #titles = new Map<string, Set<string>>()
	readonly #versions = new Map<string, string>()
	readonly #pending = new Map<string, SourceEntry>()
	readonly #unavailable = new Set<string>()
	readonly #deferred = new Set<string>()
	readonly #running = new Map<symbol, SourceEntry>()
	#pauseUntil = 0
	#resume: ReturnType<typeof setTimeout> | undefined
	inventoryComplete = false
	#closed = false
	readonly index: DiskSourceIndex
	constructor(
		readonly fetchText: (entry: SourceEntry) => Promise<SourceText>,
		scope?: string,
		readonly rateLimitBackoffMs = 60_000
	) {
		this.index = new DiskSourceIndex(
			`aven-research-${scope ?? crypto.randomUUID()}`,
			(id) => this.#entries.has(id),
			Boolean(scope)
		)
	}
	async read(entry: SourceEntry): Promise<SourceText> {
		const version = this.#versions.get(entry.artifactId)
		if (this.#closed || !version) throw Error('Source is no longer in this workspace')
		try {
			if (await this.index.hasVersion(entry.artifactId, version)) {
				const cached = await this.index.text(entry.artifactId)
				if (cached) {
					this.#unavailable.delete(entry.artifactId)
					return cached
				}
			}
		} catch {
			/* Cache failure must not prevent an authenticated source read. */
		}
		const text = await this.fetchText(entry)
		if (this.#closed || this.#versions.get(entry.artifactId) !== version)
			throw Error('Source changed during read; retry')
		try {
			await this.index.put(entry, text, version)
			if (text.complete) this.#unavailable.delete(entry.artifactId)
			else this.#unavailable.add(entry.artifactId)
		} catch {
			this.#unavailable.add(entry.artifactId)
		}
		return text
	}
	entries() {
		return [...this.#entries.values()]
	}
	resolve(key: string) {
		key = key.trim()
		const exact = this.#entries.get(key)
		if (exact) return [exact]
		return [...(this.#titles.get(key.toLowerCase()) ?? [])].flatMap((id) => {
			const e = this.#entries.get(id)
			return e ? [e] : []
		})
	}
	register(entry: SourceEntry, version = '', ready = true) {
		if (this.#closed) return
		const fingerprint = JSON.stringify(['whole-document-page-coverage-3', entry, version, ready])
		if (this.#versions.get(entry.artifactId) === fingerprint) return
		const prior = this.#entries.get(entry.artifactId)
		if (prior) this.#titles.get(prior.title.toLowerCase())?.delete(entry.artifactId)
		this.#entries.set(entry.artifactId, entry)
		this.#versions.set(entry.artifactId, fingerprint)
		const titles = this.#titles.get(entry.title.toLowerCase()) ?? new Set<string>()
		titles.add(entry.artifactId)
		this.#titles.set(entry.title.toLowerCase(), titles)
		this.#pending.delete(entry.artifactId)
		this.#deferred.delete(entry.artifactId)
		if (!ready) {
			this.#deferred.add(entry.artifactId)
			return
		}
		this.#pending.set(entry.artifactId, entry)
		this.#pump()
	}
	#pump() {
		if (this.#closed) return
		if (Date.now() < this.#pauseUntil) {
			if (!this.#resume)
				this.#resume = setTimeout(() => {
					this.#resume = undefined
					this.#pump()
				}, this.#pauseUntil - Date.now())
			return
		}
		while (!this.#closed && this.#running.size < 2 && this.#pending.size) {
			const [id, entry] = this.#pending.entries().next().value as [string, SourceEntry]
			this.#pending.delete(id)
			const attempt = Symbol()
			this.#running.set(attempt, entry)
			const version = this.#versions.get(id)
			void (async () => {
				try {
					if (version && (await this.index.hasVersion(id, version))) {
						this.#unavailable.delete(id)
						return
					}
					if (this.#closed || this.#versions.get(id) !== version) return
					const text = await this.fetchText(entry)
					if (this.#closed || this.#versions.get(id) !== version) return
					await this.index.put(entry, text, version)
					if (text.complete) this.#unavailable.delete(id)
					else this.#unavailable.add(id)
				} catch (error) {
					if (!this.#closed && this.#versions.get(id) === version) {
						if (/429|too many requests|rate.?limit/i.test(String(error))) {
							this.#pending.set(id, entry)
							this.#pauseUntil = Date.now() + this.rateLimitBackoffMs
							return
						}
						this.#unavailable.add(id)
						await this.index.put(entry, { content: '', complete: false }).catch(() => {})
					}
				} finally {
					this.#running.delete(attempt)
					setTimeout(() => this.#pump(), 0)
				}
			})()
		}
	}
	coverage(scope: { intent?: unknown; before?: unknown } = {}) {
		const intent = String(scope.intent ?? ''),
			before = String(scope.before ?? '')
		const matches = (entry: SourceEntry) =>
			(!intent || entry.intentId === intent) &&
			(!before || !entry.createdAt || entry.createdAt.slice(0, 10) <= before)
		const entries = [...this.#entries.values()].filter(matches)
		const pending = new Set([
			...this.#pending.keys(),
			...this.#deferred,
			...[...this.#running.values()].map((entry) => entry.artifactId)
		])
		return {
			pending: entries.filter((entry) => pending.has(entry.artifactId)).length,
			unavailable: entries.filter(
				(entry) => !pending.has(entry.artifactId) && this.#unavailable.has(entry.artifactId)
			).length,
			totalSources: entries.length,
			inventoryComplete: this.inventoryComplete
		}
	}
	async removeIntent(intentId: string) {
		for (const [id, e] of this.#entries)
			if (e.intentId === intentId) {
				this.#entries.delete(id)
				this.#pending.delete(id)
				this.#deferred.delete(id)
				this.#versions.delete(id)
				this.#titles.get(e.title.toLowerCase())?.delete(id)
				this.#unavailable.delete(id)
				await this.index.remove(id)
			}
	}
	close() {
		this.#closed = true
		clearTimeout(this.#resume)
		this.#pending.clear()
		this.#deferred.clear()
		this.#entries.clear()
		this.#titles.clear()
		this.#versions.clear()
		this.index.close()
	}
}
