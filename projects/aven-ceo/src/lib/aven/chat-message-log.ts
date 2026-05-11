import fs from 'node:fs'
import path from 'node:path'
import { maiaMessagesDir, migrateLegacyMessagesToMaia } from '$lib/aven/maia-messages-path'

/** Local-only Maia transcript directory; lives under `.data/agents/maia/messages`. */
export function messagesLogDir(): string {
	migrateLegacyMessagesToMaia()
	return maiaMessagesDir()
}

function ensureMessagesDir(): string {
	const root = messagesLogDir()
	if (!fs.existsSync(root)) {
		fs.mkdirSync(root, { recursive: true })
	}
	const readme = path.join(root, 'README.md')
	if (!fs.existsSync(readme)) {
		fs.writeFileSync(
			readme,
			'# README.md\n\nAgent-bound transcript under **`.data/agents/maia/messages/`**.\n\n- **`conversation.json`** — rolling chat (user / assistant turns) restored on `/talk`; if it is missing or empty, the server rebuilds from **`mN.md`** and rewrites JSON.\n- **`m1.md`, `m2.md`, …** — one Markdown file per completed assistant reply.\n\nLocal only; not committed.\n',
			'utf8'
		)
	}
	return root
}

function nextMessageIndex(dir: string): number {
	if (!fs.existsSync(dir)) return 1
	let max = 0
	for (const name of fs.readdirSync(dir)) {
		const m = /^m(\d+)\.md$/i.exec(name)
		if (m) max = Math.max(max, Number.parseInt(m[1], 10))
	}
	return max + 1
}

/**
 * Index **`mN.md`** that the **next** `persistAvenMessageTurn` will write (same logic as at persist time).
 * Used to attribute vault tool edits to the in-flight assistant turn before the file exists.
 */
export function peekNextAssistantMessageIndex(): number {
	const root = ensureMessagesDir()
	return nextMessageIndex(root)
}

export type AvenPersistMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Appends one markdown file per completed exchange: `m1.md`, `m2.md`, …
 */
export function persistAvenMessageTurn(opts: {
	messages: AvenPersistMessage[]
	assistantReply: string
	model: string
}): void {
	const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
	if (!lastUser?.content.trim()) return

	const root = ensureMessagesDir()
	const n = nextMessageIndex(root)
	const iso = new Date().toISOString()
	const body = `# m${n}.md\n\n_${opts.model}_ · _${iso}_\n\n## User\n\n${lastUser.content.trim()}\n\n## Assistant\n\n${opts.assistantReply.trim()}\n`
	fs.writeFileSync(path.join(root, `m${n}.md`), body, 'utf8')
}
