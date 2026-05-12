import fs from 'node:fs'
import path from 'node:path'
import { bodyAfterFrontmatter } from '$lib/memory/frontmatter'
import { listVaultNotes, readVaultNote, resolveRepoRoot } from '$lib/memory/vault'
import {
	forEachWikilinkPath,
	isTalkTurnWikilinkPath,
	resolveWikilinkToVaultPath
} from '$lib/memory/wikilink-parse'

export const VAULT_GRAPH_SCHEMA_VERSION = 2 as const

/** Persisted derived wikilink graph under `.data/state/vault-graph.json`. */
export type VaultGraphState = {
	schemaVersion: typeof VAULT_GRAPH_SCHEMA_VERSION
	generatedIso: string
	/** Resolved edges: source path → distinct target paths that exist in vault */
	outgoing: Record<string, string[]>
	/** Inverse index for quick backlinks */
	backlinks: Record<string, string[]>
	/** source → normalized link targets that do not resolve to an existing note */
	unresolvedFrom: Record<string, string[]>
	stats: {
		resolvedEdgeCount: number
		unresolvedTargetCount: number
	}
}

const GRAPH_FILE = 'vault-graph.json'

export function vaultStateDir(): string {
	return path.join(resolveRepoRoot(), '.data', 'state')
}

function graphFileAbs(): string {
	return path.join(vaultStateDir(), GRAPH_FILE)
}

export function ensureVaultStateDir(): void {
	const d = vaultStateDir()
	if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

function sortUnique(paths: string[]): string[] {
	return [...new Set(paths)].sort((a, b) => a.localeCompare(b))
}

function dedupeIncoming(map: Map<string, Set<string>>): Record<string, string[]> {
	const out: Record<string, string[]> = {}
	for (const [k, set] of map) {
		out[k] = sortUnique([...set])
	}
	return out
}

/**
 * Full scan of `.data/knowledge` — builds resolved + unresolved wikilink edges.
 */
export async function computeVaultGraph(): Promise<VaultGraphState> {
	const notes = await listVaultNotes()

	const outgoing = new Map<string, Set<string>>()
	const unresolvedFrom = new Map<string, Set<string>>()
	let resolvedEdgeCount = 0
	let unresolvedTargetCount = 0

	for (const { path: src } of notes) {
		let raw: string
		try {
			raw = await readVaultNote(src)
		} catch {
			continue
		}
		const body = bodyAfterFrontmatter(raw)
		const paths = notes.map((n) => n.path)
		forEachWikilinkPath(body, (pathRaw) => {
			if (isTalkTurnWikilinkPath(pathRaw)) return
			const res = resolveWikilinkToVaultPath(pathRaw, paths)
			if (res.status === 'resolved') {
				const target = res.vaultPath
				let set = outgoing.get(src)
				if (!set) {
					set = new Set()
					outgoing.set(src, set)
				}
				if (!set.has(target)) {
					set.add(target)
					resolvedEdgeCount++
				}
			} else {
				const label =
					res.status === 'ambiguous'
						? `${res.attempted} (${res.matches.length} matches)`
						: res.attempted
				let uset = unresolvedFrom.get(src)
				if (!uset) {
					uset = new Set()
					unresolvedFrom.set(src, uset)
				}
				if (!uset.has(label)) {
					uset.add(label)
					unresolvedTargetCount++
				}
			}
		})
	}

	const backlinks = new Map<string, Set<string>>()
	for (const [src, targets] of outgoing) {
		for (const t of targets) {
			let bs = backlinks.get(t)
			if (!bs) {
				bs = new Set()
				backlinks.set(t, bs)
			}
			bs.add(src)
		}
	}

	const outRecord: Record<string, string[]> = {}
	for (const [k, set] of outgoing) {
		outRecord[k] = sortUnique([...set])
	}

	const unr: Record<string, string[]> = {}
	for (const [k, set] of unresolvedFrom) {
		unr[k] = sortUnique([...set])
	}

	return {
		schemaVersion: VAULT_GRAPH_SCHEMA_VERSION,
		generatedIso: new Date().toISOString(),
		outgoing: outRecord,
		backlinks: dedupeIncoming(backlinks),
		unresolvedFrom: unr,
		stats: {
			resolvedEdgeCount,
			unresolvedTargetCount
		}
	}
}

export function writeVaultGraphState(state: VaultGraphState): void {
	ensureVaultStateDir()
	fs.writeFileSync(graphFileAbs(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export async function rebuildVaultGraph(): Promise<VaultGraphState> {
	const state = await computeVaultGraph()
	writeVaultGraphState(state)
	return state
}

/** Reads cached graph or rebuilds if missing / unreadable. */
export async function loadVaultGraph(): Promise<VaultGraphState> {
	ensureVaultStateDir()
	const abs = graphFileAbs()
	if (!fs.existsSync(abs)) {
		return rebuildVaultGraph()
	}
	try {
		const raw = fs.readFileSync(abs, 'utf8')
		const parsed = JSON.parse(raw) as Partial<VaultGraphState>
		if (
			parsed?.schemaVersion !== VAULT_GRAPH_SCHEMA_VERSION ||
			typeof parsed.generatedIso !== 'string' ||
			typeof parsed.outgoing !== 'object' ||
			typeof parsed.backlinks !== 'object' ||
			typeof parsed.unresolvedFrom !== 'object' ||
			typeof parsed.stats !== 'object'
		) {
			return rebuildVaultGraph()
		}
		return parsed as VaultGraphState
	} catch {
		return rebuildVaultGraph()
	}
}

/** Compact Markdown for Maia (bounded token use). */
export function formatVaultGraphSummaryMarkdown(state: VaultGraphState): string {
	const { resolvedEdgeCount, unresolvedTargetCount } = state.stats
	const lines: string[] = [
		'### Vault link graph (derived from `[[wikilinks]]`)',
		'',
		`- **Resolved edges:** ${resolvedEdgeCount}`,
		`- **Unresolved wikilink targets:** ${unresolvedTargetCount}`
	]
	if (unresolvedTargetCount > 0) {
		const samples: string[] = []
		for (const [src, targets] of Object.entries(state.unresolvedFrom)) {
			for (const t of targets) {
				samples.push(`\`${src}\` → missing \`${t}\``)
				if (samples.length >= 8) break
			}
			if (samples.length >= 8) break
		}
		if (samples.length) {
			lines.push(
				'',
				'Sample broken links (edit targets or create notes):',
				...samples.map((s) => `- ${s}`)
			)
		}
	}
	return lines.join('\n')
}
