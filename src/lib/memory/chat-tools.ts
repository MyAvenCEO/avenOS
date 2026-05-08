import { memoryToolSourceAls } from '$lib/aven/memory-tool-context'
import { rebuildVaultGraph } from '$lib/memory/vault-graph'
import { appendMemoryProvenance } from '$lib/memory/memory-provenance'
import {
	editVaultNote,
	ensureVaultDir,
	listVaultNotes,
	readVaultNote,
	searchVault,
	writeVaultNote
} from './vault'

function appendTalkProvenanceToVaultFile(posixPath: string): void {
	const src = memoryToolSourceAls.getStore()
	if (!src || src.type !== 'talk') return
	const withProv = appendMemoryProvenance(readVaultNote(posixPath), src)
	writeVaultNote(posixPath, withProv)
}

export {
	memoryToolDoneLine,
	memoryToolPlanLine,
	memoryToolRunningLine,
	memoryToolsOpenAI,
	memoryToolTitle,
	memoryToolTitlesLine,
	memoryVaultPathTail
} from './chat-tools-core'

/** Server-side tool execution against the local vault (Node/fs). */
export function executeMemoryTool(name: string, args: Record<string, unknown>): string {
	ensureVaultDir()
	try {
		switch (name) {
			case 'memory_list_notes':
				return JSON.stringify({ notes: listVaultNotes() })
			case 'memory_read_file': {
				const p = String(args.path ?? '')
				return readVaultNote(p)
			}
			case 'memory_edit': {
				const rel = String(args.path ?? '')
				editVaultNote(rel, String(args.oldString ?? ''), String(args.newString ?? ''))
				appendTalkProvenanceToVaultFile(rel)
				rebuildVaultGraph()
				return JSON.stringify({ ok: true, path: rel })
			}
			case 'memory_write_file': {
				const p = String(args.path ?? '')
				const content = String(args.content ?? '')
				writeVaultNote(p, content)
				appendTalkProvenanceToVaultFile(p)
				rebuildVaultGraph()
				return JSON.stringify({ ok: true, path: p, bytes: content.length })
			}
			case 'memory_search': {
				const q = String(args.query ?? '')
				const lim = typeof args.limit === 'number' ? args.limit : 20
				return JSON.stringify({ hits: searchVault(q, lim) })
			}
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` })
		}
	} catch (e) {
		return JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
	}
}
