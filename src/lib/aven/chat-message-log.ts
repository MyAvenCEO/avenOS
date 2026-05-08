import fs from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '$lib/memory/vault'

/** Local-only Maia turn log; same gitignore policy as `.data/knowledge`. */
export function messagesLogDir(): string {
	return path.join(resolveRepoRoot(), '.data', 'messages')
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
			'# Messages\n\n- **`conversation.json`** — rolling chat transcript (user / assistant turns) restored on `/talk`; if it is missing or empty, the server rebuilds from **`messageN.md`** and rewrites JSON.\n- **`messageN.md`** — append-only log per completed assistant reply.\n\nLocal only; not committed.\n',
			'utf8'
		)
	}
	return root
}

function nextMessageIndex(dir: string): number {
	if (!fs.existsSync(dir)) return 1
	let max = 0
	for (const name of fs.readdirSync(dir)) {
		const m = /^message(\d+)\.md$/i.exec(name)
		if (m) max = Math.max(max, Number.parseInt(m[1], 10))
	}
	return max + 1
}

export type AvenPersistMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Appends one markdown file per completed exchange: `message1.md`, `message2.md`, …
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
	const body = `# Message ${n}\n\n_${opts.model}_ · _${iso}_\n\n## User\n\n${lastUser.content.trim()}\n\n## Assistant\n\n${opts.assistantReply.trim()}\n`
	fs.writeFileSync(path.join(root, `message${n}.md`), body, 'utf8')
}
