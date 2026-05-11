import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSeedRuntimeSynced } from '$lib/seed/seed-service'
import { parseMarkdownFrontmatter } from './frontmatter'

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
	const root = vaultAbsolutePath()
	if (!fs.existsSync(root)) {
		fs.mkdirSync(root, { recursive: true })
	}
	return root
}

function scanMarkdownFiles(dir: string, baseRel = ''): string[] {
	const out: string[] = []
	if (!fs.existsSync(dir)) return out
	const entries = fs.readdirSync(dir, { withFileTypes: true })
	for (const e of entries) {
		const childAbs = path.join(dir, e.name)
		const childRel = baseRel ? `${baseRel}/${e.name}` : e.name
		if (e.isDirectory()) {
			out.push(...scanMarkdownFiles(childAbs, childRel))
		} else if (e.isFile() && e.name.endsWith('.md')) {
			out.push(childRel.split(path.sep).join('/'))
		}
	}
	return out
}

function extractTitleFromBody(body: string): string {
	const m = body.match(/^#\s+(.+)$/m)
	return m ? m[1].trim() : ''
}

export function listVaultNotes(): { path: string; title: string }[] {
	const root = ensureVaultDir()
	const files = scanMarkdownFiles(root)
	const list: { path: string; title: string }[] = []
	for (const posixRel of files) {
		const full = path.join(root, ...posixRel.split('/'))
		try {
			const content = fs.readFileSync(full, 'utf8')
			const { meta, body } = parseMarkdownFrontmatter(content)
			const title = extractTitleFromBody(body) || meta.title?.trim() || path.basename(full, '.md')
			list.push({ path: posixRel, title })
		} catch {
			list.push({ path: posixRel, title: path.basename(full, '.md') })
		}
	}
	return list.sort((a, b) => a.path.localeCompare(b.path))
}

export function readVaultNote(relPosix: string): string {
	const posix = assertVaultRelativePath(relPosix)
	const full = path.join(vaultAbsolutePath(), ...posix.split('/'))
	if (!fs.existsSync(full)) {
		throw new Error('Note not found.')
	}
	return fs.readFileSync(full, 'utf8')
}

export function writeVaultNote(relPosix: string, content: string): void {
	const posix = assertVaultRelativePath(relPosix)
	const full = path.join(vaultAbsolutePath(), ...posix.split('/'))
	const dir = path.dirname(full)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(full, content, 'utf8')
}

/** Replace one unique substring in a file (fail if zero or multiple matches). */
export function editVaultNote(relPosix: string, oldString: string, newString: string): void {
	const posix = assertVaultRelativePath(relPosix)
	if (!oldString) {
		throw new Error('oldString must not be empty.')
	}
	let full = readVaultNote(posix)
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
	writeVaultNote(posix, full)
}

export interface SearchHit {
	path: string
	line: number
	snippet: string
}

export function searchVault(query: string, limit = 20): SearchHit[] {
	if (!query.trim()) return []
	const root = ensureVaultDir()
	const lower = query.toLowerCase()
	const hits: SearchHit[] = []
	const seenPath = new Set<string>()

	const files = scanMarkdownFiles(root)

	for (const posixRel of files) {
		const full = path.join(root, ...posixRel.split('/'))
		let content: string
		try {
			content = fs.readFileSync(full, 'utf8')
		} catch {
			continue
		}
		if (posixRel.toLowerCase().includes(lower) && !seenPath.has(posixRel)) {
			seenPath.add(posixRel)
			hits.push({
				path: posixRel,
				line: 0,
				snippet: `(filename) ${posixRel}`
			})
			if (hits.length >= limit) return hits
		}
		const lines = content.split(/\r?\n/)
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(lower)) {
				hits.push({
					path: posixRel,
					line: i + 1,
					snippet: lines[i].trim().slice(0, 200)
				})
				if (hits.length >= limit) return hits
			}
		}
	}

	return hits.slice(0, limit)
}
