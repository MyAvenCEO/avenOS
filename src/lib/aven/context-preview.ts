import { maiaAgent } from '$lib/aven/maia-agent'
import { memoryToolsOpenAI } from '$lib/memory/chat-tools-core'

/**
 * Rough token estimate when no model tokenizer is available.
 * English-ish prose averages ~4 chars/token; JSON/tool schemas skew higher — still useful for comparisons.
 */
export function roughTokenEstimateChars(charCount: number): number {
	if (charCount <= 0) return 0
	return Math.max(1, Math.ceil(charCount / 4))
}

/** Tailwind badge classes per tool name (Talk context aside). */
export function memoryToolBadgeClasses(name: string): string {
	const tail = maiaAgent.contextPreview.toolBadgeTailwindClasses as
		| Record<string, string>
		| undefined
	return tail?.[name] ?? 'border-border/70 bg-white/25 text-foreground/85'
}

export function memoryToolNamesOrdered(): string[] {
	return memoryToolsOpenAI()
		.map((t) => (t.type === 'function' ? t.function.name : ''))
		.filter(Boolean)
}

export type AvenContextSection =
	| { id: 'soul'; heading: string; bodyLines: readonly string[]; estimatedTokens: number }
	| { id: 'rules'; heading: string; bodyLines: readonly string[]; estimatedTokens: number }
	| { id: 'vault_snapshot'; heading: string; bodyLines: readonly string[]; estimatedTokens: number }
	| {
			id: 'transcript'
			heading: string
			items: readonly { key: string; role: 'user' | 'assistant'; snippet: string }[]
			estimatedTokens: number
	  }
	| {
			id: 'tools'
			heading: string
			toolNames: readonly string[]
			estimatedTokens: number
	  }

export type AvenContextPreview = {
	/** Effective chat model for this roundtrip. */
	model: string
	/** Rough sum of §1–5 (full system blob + transcript + tools JSON); aside lists tools above messages. */
	totalEstimatedTokens: number
	/** Talk aside visual order — not the API wire shape. Last block is always messages. */
	sections: AvenContextSection[]
}

function toolsSchemaJsonChars(): number {
	try {
		return JSON.stringify(memoryToolsOpenAI()).length
	} catch {
		return 0
	}
}

/**
 * Structured description of what the server sends on the **first** chat.completions
 * call (system text + user/assistant messages + tool definitions). Tool *results*
 * are appended only in later internal rounds and are not listed here.
 */
export function buildAvenContextPreview(opts: {
	model: string
	messages: { role: 'user' | 'assistant'; content: string }[]
	soulChars: number
	instructionChars: number
	fullSystemChars: number
}): AvenContextPreview {
	const { model, messages, soulChars, instructionChars, fullSystemChars } = opts

	const soulTokens = roughTokenEstimateChars(soulChars)
	const rulesTokens = roughTokenEstimateChars(instructionChars)
	const vaultBundleChars = Math.max(0, fullSystemChars - soulChars - instructionChars)
	const vaultBundleTokens = roughTokenEstimateChars(vaultBundleChars)

	let transcriptChars = 0
	for (const m of messages) {
		transcriptChars += m.content.length + 24
	}
	const transcriptTokens = roughTokenEstimateChars(transcriptChars)

	const toolsChars = toolsSchemaJsonChars()
	const toolsTokens = roughTokenEstimateChars(toolsChars)
	const toolNames = memoryToolNamesOrdered()

	const heads = maiaAgent.contextPreview.sectionHeadings

	const soulSection: AvenContextSection = {
		id: 'soul',
		heading: heads.soul,
		estimatedTokens: soulTokens,
		bodyLines: []
	}

	const rulesSection: AvenContextSection = {
		id: 'rules',
		heading: heads.rules,
		estimatedTokens: rulesTokens,
		bodyLines: []
	}

	const vaultSection: AvenContextSection = {
		id: 'vault_snapshot',
		heading: heads.vaultSnapshot,
		estimatedTokens: vaultBundleTokens,
		bodyLines: []
	}

	const toolsSection: AvenContextSection = {
		id: 'tools',
		heading: heads.tools,
		estimatedTokens: toolsTokens,
		toolNames
	}

	const transcriptSection: AvenContextSection = {
		id: 'transcript',
		heading: heads.transcript,
		estimatedTokens: transcriptTokens,
		items: messages.map((m, i) => ({
			key: `M${i + 1}`,
			role: m.role,
			snippet:
				m.content.length > 100 ? `${m.content.slice(0, 97).trim()}…` : m.content.trim() || '(empty)'
		}))
	}

	/** Aside order: identity → procedure → vault → tools → messages (last). */
	const sections: AvenContextSection[] = [
		soulSection,
		rulesSection,
		vaultSection,
		toolsSection,
		transcriptSection
	]

	const systemTokens = roughTokenEstimateChars(fullSystemChars)
	const totalEstimatedTokens = systemTokens + transcriptTokens + toolsTokens

	return { model, sections, totalEstimatedTokens }
}
