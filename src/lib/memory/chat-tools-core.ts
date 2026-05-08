/**
 * Browser-safe definitions: OpenAI tool schemas + UX strings.
 * Procedural + identity Markdown lives under `.data/agents/maia/` (see `maia-rules-md.ts`, `soul-md.ts`).
 *
 * Tool JSON: `tools/memory.openai.json` (referenced from `aven/agents/maia.agent.json`).
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions.mjs'
import memoryToolsFromJson from './tools/memory.openai.json' with { type: 'json' }

export function memoryToolsOpenAI(): ChatCompletionTool[] {
	return memoryToolsFromJson as ChatCompletionTool[]
}

/** Short path tail for status copy (vault-relative, truncated). */
export function memoryVaultPathTail(p: unknown, max = 44): string {
	const s = String(p ?? '')
		.replace(/\\/g, '/')
		.trim()
	if (!s) return '…'
	return s.length > max ? `…${s.slice(-(max - 1))}` : s
}

/** User-facing line while a tool runs (shown in Maia status badge). */
export function memoryToolRunningLine(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case 'memory_list_notes':
			return 'Refreshing note list…'
		case 'memory_read_file':
			return `Reading ${memoryVaultPathTail(args.path)}…`
		case 'memory_edit':
			return `Editing ${memoryVaultPathTail(args.path)}…`
		case 'memory_write_file':
			return `Writing ${memoryVaultPathTail(args.path)}…`
		case 'memory_search': {
			const q = String(args.query ?? '').trim()
			const short = q.length > 40 ? `${q.slice(0, 38)}…` : q || '…'
			return `Searching vault for “${short}”…`
		}
		default:
			return `Running ${name}…`
	}
}

/** Short confirmation after a tool returns (optional follow-up line). */
export function memoryToolDoneLine(name: string): string {
	switch (name) {
		case 'memory_list_notes':
			return 'Note list ready…'
		case 'memory_read_file':
			return 'Read finished…'
		case 'memory_edit':
			return 'Edit saved…'
		case 'memory_write_file':
			return 'Write saved…'
		case 'memory_search':
			return 'Search done…'
		default:
			return 'Done…'
	}
}

/** One badge line when several tools are queued for this round. */
export function memoryToolPlanLine(names: string[]): string {
	const chips = [...new Set(names)].map((n) => {
		switch (n) {
			case 'memory_list_notes':
				return 'List notes'
			case 'memory_read_file':
				return 'Read'
			case 'memory_edit':
				return 'Edit'
			case 'memory_write_file':
				return 'Write'
			case 'memory_search':
				return 'Search'
			default:
				return n.replace(/^memory_/, '')
		}
	})
	return `${chips.join(' · ')}…`
}
