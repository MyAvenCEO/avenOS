#!/usr/bin/env bun
/**
 * Fail if any Markdown file under self/founders/ or self/developers/ exceeds MAX_WORDS
 * (excluding YAML frontmatter).
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX = 850
const HERE = dirname(fileURLToPath(import.meta.url))
const SELF_DIR = join(HERE, '..', 'self')

const GROUPS = ['founders', 'developers'] as const

function stripFrontmatter(src: string): string {
	const m = src.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
	if (m) return src.slice(m[0].length)
	return src
}

function countWords(text: string): number {
	return text.trim().split(/\s+/g).filter(Boolean).length
}

let failed = false

for (const group of GROUPS) {
	const dir = join(SELF_DIR, group)
	let files: string[]
	try {
		files = await readdir(dir)
	} catch {
		console.warn(`  (no ${group}/ directory found, skipping)`)
		continue
	}
	console.log(`\n${group}/`)
	for (const name of files.sort()) {
		if (!name.endsWith('.md')) continue
		const raw = await readFile(join(dir, name), 'utf8')
		const n = countWords(stripFrontmatter(raw))
		if (n > MAX) {
			console.error(`  ${name}: ${n} words (max ${MAX})`)
			failed = true
		} else {
			console.log(`  ${name}: ${n} words`)
		}
	}
}

if (failed) {
	console.error('\nwords:check failed: shorten chapters or raise the limit deliberately.')
	process.exit(1)
}
