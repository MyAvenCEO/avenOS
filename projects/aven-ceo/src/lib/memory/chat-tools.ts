import { memoryToolSourceAls } from '$lib/aven/memory-tool-context'
import { rebuildVaultGraph } from '$lib/memory/vault-graph'
import {
	editVaultNote,
	ensureVaultDir,
	listVaultNotes,
	readVaultNote,
	searchVault,
	writeVaultNote
} from './vault'

export {
	memoryToolDoneLine,
	memoryToolPlanLine,
	memoryToolRunningLine,
	memoryToolsOpenAI,
	memoryToolTitle,
	memoryToolTitlesLine,
	memoryVaultPathTail
} from './chat-tools-core'

/** Server-side tool execution against Jazz-backed memory with fs projection export. */
export async function executeMemoryTool(name: string, args: Record<string, unknown>): Promise<string> {
	ensureVaultDir()
	try {
		switch (name) {
			case 'memory_list_notes':
				return JSON.stringify({ notes: await listVaultNotes() })
			case 'memory_read_file': {
				const p = String(args.path ?? '')
				return await readVaultNote(p)
			}
			case 'memory_edit': {
				const rel = String(args.path ?? '')
				const src = memoryToolSourceAls.getStore() ?? { type: 'memory_ui' as const }
				await editVaultNote(rel, String(args.oldString ?? ''), String(args.newString ?? ''), src)
				await rebuildVaultGraph()
				return JSON.stringify({ ok: true, path: rel })
			}
			case 'memory_write_file': {
				const p = String(args.path ?? '')
				const content = String(args.content ?? '')
				const src = memoryToolSourceAls.getStore() ?? { type: 'memory_ui' as const }
				await writeVaultNote(p, content, src)
				await rebuildVaultGraph()
				return JSON.stringify({ ok: true, path: p, bytes: content.length })
			}
			case 'memory_search': {
				const q = String(args.query ?? '')
				const lim = typeof args.limit === 'number' ? args.limit : 20
				return JSON.stringify({ hits: await searchVault(q, lim) })
			}
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` })
		}
	} catch (e) {
		return JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
	}
}
