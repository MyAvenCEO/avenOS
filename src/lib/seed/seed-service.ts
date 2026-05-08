import fs from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '$lib/memory/vault'

/** OpenAI-format memory tool definitions living under `.data/` after sync (editable at runtime). */
export function maiaMemoryToolsJsonPath(): string {
	return path.join(resolveRepoRoot(), '.data', 'agents', 'maia', 'tools', 'memory.openai.json')
}

function seedDir(): string {
	return path.join(resolveRepoRoot(), 'seed')
}

function copySeedIfMissing(seedRel: string, destAbs: string): void {
	const src = path.join(seedDir(), ...seedRel.split('/'))
	if (!fs.existsSync(src)) {
		throw new Error(`Missing committed seed file: ${src}`)
	}
	if (fs.existsSync(destAbs)) return
	fs.mkdirSync(path.dirname(destAbs), { recursive: true })
	fs.copyFileSync(src, destAbs)
}

let didSync = false

/**
 * Copies known seed files into `.data/` once per process when targets are missing.
 * Does not overwrite existing runtime files (user/agent edits stay).
 */
export function ensureSeedRuntimeSynced(): void {
	if (didSync) return
	didSync = true

	const root = resolveRepoRoot()

	copySeedIfMissing('agents/maia/SOUL.md', path.join(root, '.data', 'agents', 'maia', 'SOUL.md'))
	copySeedIfMissing(
		'memory/tools/memory.openai.json',
		path.join(root, '.data', 'agents', 'maia', 'tools', 'memory.openai.json')
	)
}
