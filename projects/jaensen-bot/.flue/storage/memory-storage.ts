import type { ArchiveStore, IntentRecord, IntentStore, JaensenStorage, MemoryStore } from './types.js'

export function createMemoryStorage(): JaensenStorage {
	return {
		intents: new InMemoryIntentStore(),
		memory: new InMemoryMemoryStore(),
		archive: new InMemoryArchiveStore()
	}
}

class InMemoryIntentStore implements IntentStore {
	private intents = new Map<string, IntentRecord>()
	async listActive() { return [...this.intents.values()].filter((intent) => intent.status !== 'resolved') }
	async getById(id: string) { return this.intents.get(id) ?? null }
	async save(intent: IntentRecord) { this.intents.set(intent.id, intent) }
}

class InMemoryMemoryStore implements MemoryStore {
	private topics = new Map<string, string>()
	async readTopic(topic: string) { return this.topics.get(topic) ?? null }
	async appendTopicNote(topic: string, note: string) {
		const current = this.topics.get(topic) ?? `# ${topic}\n`
		this.topics.set(topic, `${current.trimEnd()}\n\n## ${new Date().toISOString()}\n${note.trim()}\n`)
	}
	async search(query: string) {
		const words = query.toLowerCase().split(/[^a-z0-9]+/i).filter((word) => word.length >= 4)
		return [...this.topics.entries()]
			.filter(([, content]) => words.some((word) => content.toLowerCase().includes(word)))
			.map(([topic, snippet]) => ({ topic, snippet: snippet.slice(0, 400) }))
	}
}

class InMemoryArchiveStore implements ArchiveStore {
	private items = new Map<string, { content: Uint8Array; contentType?: string; metadata?: Record<string, unknown> }>()
	async put(item: { key?: string; content: Uint8Array; contentType?: string; metadata?: Record<string, unknown> }) {
		const key = item.key ?? `archive-${Date.now()}`
		this.items.set(key, { content: item.content, contentType: item.contentType, metadata: item.metadata })
		return { key }
	}
	async get(key: string) { return this.items.get(key) ?? null }
}