export interface IntentEvent {
	timestamp: string
	source: 'user' | 'system' | 'skill' | 'human'
	type: string
	data: Record<string, unknown>
}

export interface IntentRecord {
	id: string
	title: string
	summary: string
	status: 'active' | 'pending' | 'resolved'
	createdAt: string
	updatedAt: string
	events: IntentEvent[]
	context: Record<string, unknown>
	humanLoop?: {
		needed: boolean
		reason?: string
		message?: string
	}
}

export interface IntentStore {
	listActive(): Promise<IntentRecord[]>
	getById(id: string): Promise<IntentRecord | null>
	save(intent: IntentRecord): Promise<void>
}

export interface MemoryStore {
	readTopic(topic: string): Promise<string | null>
	appendTopicNote(topic: string, note: string): Promise<void>
	search(query: string): Promise<Array<{ topic: string; snippet: string }>>
}

export interface ArchiveStore {
	put(item: {
		key?: string
		content: Uint8Array
		contentType?: string
		metadata?: Record<string, unknown>
	}): Promise<{ key: string }>
	get(key: string): Promise<{
		content: Uint8Array
		contentType?: string
		metadata?: Record<string, unknown>
	} | null>
}

export interface JaensenStorage {
	intents: IntentStore
	memory: MemoryStore
	archive: ArchiveStore
}