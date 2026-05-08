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

/** Short product title for status badge (tool id → human label). */
export function memoryToolTitle(name: string): string {
	switch (name) {
		case 'memory_list_notes':
			return 'List notes'
		case 'memory_read_file':
			return 'Read note'
		case 'memory_edit':
			return 'Edit note'
		case 'memory_write_file':
			return 'Write note'
		case 'memory_search':
			return 'Search vault'
		default:
			return name.replace(/^memory_/, '').replace(/_/g, ' ') || name
	}
}

/** User-facing line while a tool runs (shown in Maia status badge). */
export function memoryToolRunningLine(name: string, args: Record<string, unknown>): string {
	const title = memoryToolTitle(name)
	switch (name) {
		case 'memory_list_notes':
			return `${title} · scanning vault…`
		case 'memory_read_file':
			return `${title} · ${memoryVaultPathTail(args.path)}`
		case 'memory_edit':
			return `${title} · ${memoryVaultPathTail(args.path)}`
		case 'memory_write_file':
			return `${title} · ${memoryVaultPathTail(args.path)}`
		case 'memory_search': {
			const q = String(args.query ?? '').trim()
			const short = q.length > 40 ? `${q.slice(0, 38)}…` : q || '…'
			return `${title} · “${short}”`
		}
		default:
			return `${title} · running…`
	}
}

/** Short confirmation after a tool returns (optional follow-up line). */
export function memoryToolDoneLine(name: string): string {
	const title = memoryToolTitle(name)
	switch (name) {
		case 'memory_list_notes':
			return `${title} · done`
		case 'memory_read_file':
			return `${title} · done`
		case 'memory_edit':
			return `${title} · saved`
		case 'memory_write_file':
			return `${title} · saved`
		case 'memory_search':
			return `${title} · done`
		default:
			return `${title} · done`
	}
}

/** When the model queued several tools in one round. */
export function memoryToolPlanLine(names: string[]): string {
	const chips = [...new Set(names)].map((n) => memoryToolTitle(n))
	return `Tools · ${chips.join(' + ')}…`
}

/** Summarize tool ids for “after …” thinking state. */
export function memoryToolTitlesLine(names: string[]): string {
	return [...new Set(names)].map((n) => memoryToolTitle(n)).join(' + ')
}
