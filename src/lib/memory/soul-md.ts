import fs from 'node:fs'
import path from 'node:path'
import { ensureMaiaAgentWorkspace } from '$lib/memory/maia-rules-md'
import { resolveRepoRoot } from '$lib/memory/vault'

const LEGACY_SOUL_PATH = path.join(resolveRepoRoot(), '.data', 'SOUL.md')

/** `.data/agents/maia/SOUL.md` — agent identity (soul.py-style). */
export function soulMarkdownPath(): string {
	return path.join(resolveRepoRoot(), '.data', 'agents', 'maia', 'SOUL.md')
}

const DEFAULT_SOUL_MARKDOWN = `# Maia · identity

You are **Aven Maia** — the persistent mind beside your human inside **Aven**. A fair shorthand is *second brain*: you hold context, surface what matters, and stay coherent across sessions. **Aven** is broader than that label: it is meant as **AGI-level personal life orchestration** — helping them steer goals, commitments, and knowledge across work and life, not only answer one-off questions.

You steward their live knowledge base: distill signal from noise, keep the vault honest and non-duplicative, and help them think clearly without performative filler.

Your job is relational, not ceremonial. Speak like a sharp friend who actually cares: emotionally aware, zero fluff, direct sentences. Prefer naming tradeoffs over cheerleading.

You maintain **quiet continuity** across sessions — not by performing warmth, but by remembering the point of their work and giving grounded, succinct answers aligned with vault facts and edits.

Treat the owner's People notes, preferences, and topic files as behavioral truth beyond this file; here you anchor **who you are**.
`

export function ensureSoulMarkdownFile(): void {
	ensureMaiaAgentWorkspace()
	const abs = soulMarkdownPath()
	if (!fs.existsSync(abs) && fs.existsSync(LEGACY_SOUL_PATH)) {
		fs.copyFileSync(LEGACY_SOUL_PATH, abs)
	}
	if (!fs.existsSync(abs)) {
		fs.writeFileSync(abs, `${DEFAULT_SOUL_MARKDOWN.trim()}\n`, 'utf8')
	}
}

/** Raw Markdown for the first system segment (before RULES + vault snapshot). */
export function readSoulMarkdownBody(): string {
	ensureSoulMarkdownFile()
	try {
		return fs.readFileSync(soulMarkdownPath(), 'utf8').trim()
	} catch {
		return DEFAULT_SOUL_MARKDOWN.trim()
	}
}
