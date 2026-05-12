import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSeedRuntimeSynced } from '../seed/seed-service'
import {
	listMemoryNotes,
	readMemoryNoteByPath,
	searchMemory,
	writeMemoryNoteByPath
} from './jazz-memory-store'

type MemoryWriteSource = Parameters<typeof writeMemoryNoteByPath>[2]

function repoRootFromModule(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	// file is src/lib/memory/vault.ts → app root (package with seed/ + .data/) is four levels up
	return path.resolve(here, '..', '..', '..', '..')
}

/** Prefer `process.cwd()` when available (dev server from repo root). */
export function resolveRepoRoot(): string {
	try {
		if (typeof process !== 'undefined' && process.cwd) {
			return process.cwd()
		}
	} catch {
		/* noop */
	}
	return repoRootFromModule()
}

export function vaultAbsolutePath(): string {
	return path.join(resolveRepoRoot(), '.data', 'knowledge')
}

/**
 * Validates `rel` as a path under the vault (no "..", no absolute).
 * Returns normalized path using the current platform separator for joining.
 */
export function assertVaultRelativePath(rel: string): string {
	if (!rel || typeof rel !== 'string') {
		throw new Error('Path is required.')
	}
	const posix = rel.replace(/\\/g, '/').replace(/^\/+/, '')
	if (!posix || posix.includes('..') || path.posix.isAbsolute(posix)) {
		throw new Error('Invalid path.')
	}
	const resolvedVault = path.resolve(vaultAbsolutePath())
	const abs = path.resolve(vaultAbsolutePath(), posix)
	if (abs !== resolvedVault && !abs.startsWith(`${resolvedVault}${path.sep}`)) {
		throw new Error('Path escapes vault.')
	}
	return posix
}

export function ensureVaultDir(): string {
	ensureSeedRuntimeSynced()
	return vaultAbsolutePath()
}

export async function listVaultNotes(): Promise<{ path: string; title: string }[]> {
	ensureVaultDir()
	const notes = await listMemoryNotes()
	return notes.map(({ path, title }) => ({ path, title })).sort((a, b) => a.path.localeCompare(b.path))
}

export async function readVaultNote(relPosix: string): Promise<string> {
	const posix = assertVaultRelativePath(relPosix)
	const note = await readMemoryNoteByPath(posix)
	return note.bodyMarkdown
}

export async function writeVaultNote(
	relPosix: string,
	content: string,
	source: MemoryWriteSource = { type: 'memory_ui' }
): Promise<void> {
	const posix = assertVaultRelativePath(relPosix)
	await writeMemoryNoteByPath(posix, content, source)
}

/** Replace one unique substring in a file (fail if zero or multiple matches). */
export async function editVaultNote(
	relPosix: string,
	oldString: string,
	newString: string,
	source: MemoryWriteSource = { type: 'memory_ui' }
): Promise<void> {
	const posix = assertVaultRelativePath(relPosix)
	if (!oldString) {
		throw new Error('oldString must not be empty.')
	}
	let full = await readVaultNote(posix)
	const idx = full.indexOf(oldString)
	if (idx === -1) {
		throw new Error('oldString was not found in file.')
	}
	const second = full.indexOf(oldString, idx + oldString.length)
	if (second !== -1) {
		throw new Error(
			'oldString matched multiple times; include more surrounding lines for a unique slice.'
		)
	}
	full = full.slice(0, idx) + newString + full.slice(idx + oldString.length)
	await writeVaultNote(posix, full, source)
}

export interface SearchHit {
	path: string
	line: number
	snippet: string
}

export async function searchVault(query: string, limit = 20): Promise<SearchHit[]> {
	const result = await searchMemory(query, limit)
	return result.hits.map(({ path, line, snippet }) => ({ path, line, snippet }))
}
