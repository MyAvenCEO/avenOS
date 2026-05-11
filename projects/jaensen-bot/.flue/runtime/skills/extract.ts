import { Buffer } from 'buffer'
import { extname, basename } from 'path'
import { runWorkerTask } from '../worker.js'
import type { SkillAction, SkillResult } from '../types.js'
import type { RuntimeDependencies } from '../types.js'
import type { IntentRecord } from '../../storage/types.js'

export async function runExtractSkill(intent: IntentRecord, action: Extract<SkillAction, { skill: 'extract' }>, deps: RuntimeDependencies): Promise<SkillResult> {
	const worker = await runWorkerTask({ sandboxFactory: deps.sandboxFactory, intent, skill: 'extract', workerType: action.operation, skillDoc: deps.skillDocs.extract, task: action.input })
	const key = typeof action.input.key === 'string' ? action.input.key : undefined
	if (!key) return { skill: 'extract', ok: false, summary: 'No archive key provided' }
	const archived = await deps.storage.archive.get(key)
	if (!archived) return { skill: 'extract', ok: false, summary: `Archive ${key} not found` }
	const text = extractTextFromBytes(archived.content, key, archived.contentType)
	if (action.operation === 'extract-entities') {
		return { skill: 'extract', ok: worker.exitCode === 0, summary: `Extracted entities from ${key}`, data: { key, entities: extractEntities(text), text, worker } }
	}
	return { skill: 'extract', ok: worker.exitCode === 0, summary: `Extracted text from ${key}`, data: { key, text, worker } }
}

function extractTextFromBytes(content: Uint8Array, key: string, contentType?: string): string {
	const extension = extname(key).toLowerCase() || extensionFromType(contentType)
	if (['.txt', '.md', '.json', '.html', '.htm', '.csv'].includes(extension)) {
		const text = Buffer.from(content).toString('utf-8')
		return extension === '.html' || extension === '.htm' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : text
	}
	return `Text extraction is not implemented for ${basename(key)}.`
}

function extractEntities(text: string): string[] {
	return [...new Set((text.match(/\b[A-Z][a-zA-Z0-9#-]{2,}\b/g) ?? []).slice(0, 20))]
}

function extensionFromType(contentType?: string): string {
	if (!contentType) return '.bin'
	if (contentType.includes('json')) return '.json'
	if (contentType.includes('html')) return '.html'
	if (contentType.includes('text/plain')) return '.txt'
	if (contentType.includes('markdown')) return '.md'
	return '.bin'
}