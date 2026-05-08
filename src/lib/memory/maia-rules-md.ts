import fs from 'node:fs'
import path from 'node:path'
import { parseMarkdownFrontmatter } from '$lib/memory/frontmatter'
import { resolveRepoRoot } from '$lib/memory/vault'

const MAIA_AGENT_DIR_SEG = ['.data', 'agents', 'maia'] as const

/** Repo bootstrap when no legacy runtime file exists. */
const RULES_SEED_REPO_PATH = path.join(
	resolveRepoRoot(),
	'src',
	'lib',
	'memory',
	'prompts',
	'maia-assistant.md'
)

const LEGACY_RULES_PATH = path.join(resolveRepoRoot(), '.data', 'context', 'MaiaInstructions.md')

function maiaAgentDir(): string {
	return path.join(resolveRepoRoot(), ...MAIA_AGENT_DIR_SEG)
}

export function maiaAgentDataDir(): string {
	return maiaAgentDir()
}

export function maiaReadmePath(): string {
	return path.join(maiaAgentDir(), 'README.md')
}

const MAIA_README = `# Maia runtime Markdown

Paths below are injected into Talk **before** vault snapshot JSON (outside \`src/\`).

| File | Role |
|------|------|
| \`SOUL.md\` | Identity |
| \`RULES.md\` | Procedures: snapshot discipline, tools, duplicates |

Knowledge notes live under \`.data/knowledge/\`. The vault **index table** is generated each request, not saved here.
`

export function ensureMaiaAgentWorkspace(): void {
	const dir = maiaAgentDir()
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
	const readme = path.join(dir, 'README.md')
	if (!fs.existsSync(readme)) fs.writeFileSync(readme, MAIA_README, 'utf8')
}

export function maiaRulesDataPath(): string {
	return path.join(maiaAgentDir(), 'RULES.md')
}

export function ensureMaiaRulesFile(): void {
	ensureMaiaAgentWorkspace()
	const abs = maiaRulesDataPath()
	if (fs.existsSync(abs)) return
	if (fs.existsSync(LEGACY_RULES_PATH)) {
		fs.copyFileSync(LEGACY_RULES_PATH, abs)
		return
	}
	if (!fs.existsSync(RULES_SEED_REPO_PATH)) {
		throw new Error(
			`Missing seed ${RULES_SEED_REPO_PATH} and no ${abs} — cannot bootstrap Maia RULES.md.`
		)
	}
	fs.writeFileSync(abs, fs.readFileSync(RULES_SEED_REPO_PATH, 'utf8'), 'utf8')
}

export function readMaiaRulesDoc(): { meta: Record<string, unknown>; body: string } {
	ensureMaiaRulesFile()
	const raw = fs.readFileSync(maiaRulesDataPath(), 'utf8')
	const doc = parseMarkdownFrontmatter(raw)
	return { meta: doc.meta, body: doc.body.trim() }
}
