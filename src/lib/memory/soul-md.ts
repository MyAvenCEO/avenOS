import fs from 'node:fs'
import path from 'node:path'
import { ensureMaiaAgentWorkspace } from '$lib/memory/maia-rules-md'
import { resolveRepoRoot } from '$lib/memory/vault'
import { ensureSeedRuntimeSynced } from '$lib/seed/seed-service'

const LEGACY_SOUL_PATH = path.join(resolveRepoRoot(), '.data', 'SOUL.md')

const SOUL_SEED_PATH = path.join(resolveRepoRoot(), 'seed', 'agents', 'maia', 'SOUL.md')

/** `.data/agents/maia/SOUL.md` — agent identity (soul.py-style). */
export function soulMarkdownPath(): string {
	return path.join(resolveRepoRoot(), '.data', 'agents', 'maia', 'SOUL.md')
}

function readFallbackSoul(): string {
	if (fs.existsSync(SOUL_SEED_PATH)) {
		try {
			return fs.readFileSync(SOUL_SEED_PATH, 'utf8').trim()
		} catch {
			/* fall through */
		}
	}
	return '# Maia identity\n\n(Seed SOUL file missing — restore `seed/agents/maia/SOUL.md`.)'
}

export function ensureSoulMarkdownFile(): void {
	ensureMaiaAgentWorkspace()
	ensureSeedRuntimeSynced()
	const abs = soulMarkdownPath()
	if (fs.existsSync(abs)) return
	if (fs.existsSync(LEGACY_SOUL_PATH)) {
		fs.copyFileSync(LEGACY_SOUL_PATH, abs)
		return
	}
	if (!fs.existsSync(SOUL_SEED_PATH)) {
		throw new Error(`Missing seed SOUL at ${SOUL_SEED_PATH}`)
	}
	fs.writeFileSync(abs, fs.readFileSync(SOUL_SEED_PATH, 'utf8'), 'utf8')
}

/** Raw Markdown for the first system segment (before RULES + vault snapshot). */
export function readSoulMarkdownBody(): string {
	ensureSoulMarkdownFile()
	try {
		return fs.readFileSync(soulMarkdownPath(), 'utf8').trim()
	} catch {
		return readFallbackSoul()
	}
}
