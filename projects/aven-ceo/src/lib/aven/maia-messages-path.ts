import fs from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '$lib/memory/vault'

/** Repo-relative path (POSIX) for Maia transcript + per-turn logs — agent-bound context. */
export const MAIA_MESSAGES_REL = '.data/agents/maia/messages' as const

export function maiaMessagesDir(): string {
	return path.join(resolveRepoRoot(), '.data', 'agents', 'maia', 'messages')
}

function legacyMessagesDir(): string {
	return path.join(resolveRepoRoot(), '.data', 'messages')
}

let migrationRan = false

/**
 * Best-effort copy from pre–agent-scope `.data/messages/` so existing chats survive
 * the move to `.data/agents/maia/messages/` (`conversation.json`, `messageN.md` → `mN.md`).
 * Idempotent per server process.
 */
export function migrateLegacyMessagesToMaia(): void {
	if (migrationRan) return
	migrationRan = true

	const next = maiaMessagesDir()
	const old = legacyMessagesDir()
	if (!fs.existsSync(old)) return

	if (!fs.existsSync(next)) {
		fs.mkdirSync(next, { recursive: true })
	}

	const cjOld = path.join(old, 'conversation.json')
	const cjNew = path.join(next, 'conversation.json')
	if (fs.existsSync(cjOld) && !fs.existsSync(cjNew)) {
		fs.copyFileSync(cjOld, cjNew)
	}

	for (const name of fs.readdirSync(old)) {
		const m = /^message(\d+)\.md$/i.exec(name)
		if (!m) continue
		const dest = path.join(next, `m${m[1]}.md`)
		if (!fs.existsSync(dest)) {
			fs.copyFileSync(path.join(old, name), dest)
		}
	}
}
