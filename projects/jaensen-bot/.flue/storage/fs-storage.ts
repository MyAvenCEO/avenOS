import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ArchiveStore, IntentRecord, IntentStore, JaensenStorage, MemoryStore } from './types.js'

const STATE_DIR = '.flue/state'
const MEMORY_DIR = '.flue/memory'
const ARCHIVE_DIR = '.flue/archive'
const INTENTS_FILE = 'intents.json'

export async function createFsStorage(baseDir: string): Promise<JaensenStorage> {
	const stateDir = join(baseDir, STATE_DIR)
	const memoryDir = join(baseDir, MEMORY_DIR)
	const archiveDir = join(baseDir, ARCHIVE_DIR)
	await Promise.all([
		mkdir(stateDir, { recursive: true }),
		mkdir(memoryDir, { recursive: true }),
		mkdir(archiveDir, { recursive: true })
	])
	return {
		intents: new FsIntentStore(join(stateDir, INTENTS_FILE)),
		memory: new FsMemoryStore(memoryDir),
		archive: new FsArchiveStore(archiveDir)
	}
}

class FsIntentStore implements IntentStore {
	constructor(private filePath: string) {}
	private async readAll(): Promise<IntentRecord[]> {
		try {
			return JSON.parse(await readFile(this.filePath, 'utf-8')) as IntentRecord[]
		} catch {
			return []
		}
	}
	private async writeAll(intents: IntentRecord[]) {
		await writeFile(this.filePath, JSON.stringify(intents, null, 2), 'utf-8')
	}
	async listActive() {
		return (await this.readAll()).filter((intent) => intent.status !== 'resolved')
	}
	async getById(id: string) {
		return (await this.readAll()).find((intent) => intent.id === id) ?? null
	}
	async save(intent: IntentRecord) {
		const intents = await this.readAll()
		const index = intents.findIndex((entry) => entry.id === intent.id)
		if (index >= 0) intents[index] = intent
		else intents.push(intent)
		await this.writeAll(intents)
	}
}

class FsMemoryStore implements MemoryStore {
	constructor(private memoryDir: string) {}
	async readTopic(topic: string) {
		try {
			return await readFile(join(this.memoryDir, `${slugify(topic)}.md`), 'utf-8')
		} catch {
			return null
		}
	}
	async appendTopicNote(topic: string, note: string) {
		const path = join(this.memoryDir, `${slugify(topic)}.md`)
		const current = (await this.readTopic(topic)) ?? `# ${topic}\n`
		await writeFile(path, `${current.trimEnd()}\n\n## ${new Date().toISOString()}\n${note.trim()}\n`, 'utf-8')
	}
	async search(query: string) {
		let files: string[] = []
		try {
			files = (await readdir(this.memoryDir)).filter((file) => file.endsWith('.md'))
		} catch {
			return []
		}
		const keywords = query.toLowerCase().split(/[^a-z0-9]+/i).filter((word) => word.length >= 4)
		const results: Array<{ topic: string; snippet: string }> = []
		for (const file of files) {
			const content = await readFile(join(this.memoryDir, file), 'utf-8')
			const lines = content.split('\n').filter((line) => keywords.some((word) => line.toLowerCase().includes(word)))
			if (lines.length > 0) results.push({ topic: file.replace(/\.md$/, ''), snippet: lines.slice(0, 6).join('\n') })
		}
		return results.slice(0, 5)
	}
}

class FsArchiveStore implements ArchiveStore {
	constructor(private archiveDir: string) {}
	async put(item: { key?: string; content: Uint8Array; contentType?: string; metadata?: Record<string, unknown> }) {
		const key = item.key ?? `archive-${Date.now()}`
		await writeFile(join(this.archiveDir, key), item.content)
		await writeFile(join(this.archiveDir, `${key}.meta.json`), JSON.stringify({ contentType: item.contentType, metadata: item.metadata }, null, 2), 'utf-8')
		return { key }
	}
	async get(key: string) {
		try {
			const content = new Uint8Array(await readFile(join(this.archiveDir, key)))
			let meta: { contentType?: string; metadata?: Record<string, unknown> } = {}
			try {
				meta = JSON.parse(await readFile(join(this.archiveDir, `${key}.meta.json`), 'utf-8'))
			} catch {}
			return { content, contentType: meta.contentType, metadata: meta.metadata }
		} catch {
			return null
		}
	}
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topic'
}