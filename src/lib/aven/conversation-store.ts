import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { resolveRepoRoot } from '$lib/memory/vault'

const CONV_FILE = 'conversation.json'

function messagesDir(): string {
	return path.join(resolveRepoRoot(), '.data', 'messages')
}

const fileSchema = z.object({
	messages: z.array(
		z.object({
			role: z.enum(['user', 'assistant']),
			content: z.string()
		})
	)
})

export type AvenConversationMessage = z.infer<typeof fileSchema>['messages'][number]

function conversationPath(): string {
	return path.join(messagesDir(), CONV_FILE)
}

/** Same shape as `persistAvenMessageTurn` — parse User / Assistant sections. */
function parseTurnMarkdown(source: string): { user: string; assistant: string } | null {
	const userBlock =
		/## User\s*\r?\n\r?\n([\s\S]*?)(?=\r?\n## Assistant\s|$)/i.exec(source) ??
		/## User\s*\r?\n([\s\S]*?)(?=\r?\n## Assistant\s|$)/i.exec(source)
	const asstBlock = /## Assistant\s*\r?\n\r?\n([\s\S]*)$/i.exec(source)
	if (!userBlock?.[1] || !asstBlock?.[1]) return null
	const user = userBlock[1].trim()
	const assistant = asstBlock[1].trim()
	if (!user && !assistant) return null
	return { user, assistant }
}

/** Sorted indexes from filenames `message1.md`, … */
function listMessageTurnIndexes(dir: string): number[] {
	const out: number[] = []
	if (!fs.existsSync(dir)) return out
	for (const name of fs.readdirSync(dir)) {
		const m = /^message(\d+)\.md$/i.exec(name)
		if (m) out.push(Number.parseInt(m[1], 10))
	}
	out.sort((a, b) => a - b)
	return out
}

/**
 * Rebuild `{ role, content }[]` from per-turn markdown logs (`messageN.md`).
 * Used when **`conversation.json`** is missing / empty — e.g. JSON write failed earlier.
 */
function rebuildConversationFromMessageLogs(): AvenConversationMessage[] {
	const dir = messagesDir()
	const messages: AvenConversationMessage[] = []
	for (const n of listMessageTurnIndexes(dir)) {
		const fp = path.join(dir, `message${n}.md`)
		let raw: string
		try {
			raw = fs.readFileSync(fp, 'utf8')
		} catch {
			continue
		}
		const pair = parseTurnMarkdown(raw)
		if (!pair) continue
		messages.push({ role: 'user', content: pair.user })
		messages.push({ role: 'assistant', content: pair.assistant })
	}
	return messages
}

function readMessagesFromJsonFile(): AvenConversationMessage[] {
	const p = conversationPath()
	if (!fs.existsSync(p)) return []
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(p, 'utf8'))
		const parsed = fileSchema.safeParse(raw)
		return parsed.success ? parsed.data.messages : []
	} catch {
		return []
	}
}

/** Reads rolling transcript JSON; falls back to `messageN.md` logs and restores JSON. */
export function readAvenConversation(): AvenConversationMessage[] {
	const fromJson = readMessagesFromJsonFile()
	if (fromJson.length > 0) return fromJson

	const rebuilt = rebuildConversationFromMessageLogs()
	if (rebuilt.length > 0) {
		try {
			writeAvenConversation(rebuilt)
		} catch {
			/* best-effort repair of missing conversation.json */
		}
	}
	return rebuilt
}

export function writeAvenConversation(messages: AvenConversationMessage[]): void {
	const dir = messagesDir()
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
	fs.writeFileSync(conversationPath(), JSON.stringify({ messages }, null, 2), 'utf8')
}
