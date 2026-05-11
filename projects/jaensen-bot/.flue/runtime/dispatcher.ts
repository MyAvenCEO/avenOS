import { createIntentRecord } from './intent.js'
import type { DispatcherRoutingDecision, JaensenInput, RuntimeDependencies } from './types.js'
import type { IntentRecord } from '../storage/types.js'

export async function routeInputToIntents(input: JaensenInput, activeIntents: IntentRecord[], generate: (prompt: string) => Promise<string>): Promise<DispatcherRoutingDecision> {
	const pinnedIntentId = typeof input.metadata?.intentId === 'string' ? input.metadata.intentId : undefined
	if (pinnedIntentId) {
		console.log('[jaensen] dispatcher:pinned-intent', { intentId: pinnedIntentId })
		return { relevantIntentIds: [pinnedIntentId] }
	}
	const prompt = `DISPATCHER_ROUTING_DECISION\nReturn strict JSON with shape {"relevantIntentIds": string[], "createIntent": {"title": string, "summary": string} | null}.\nIdentify which existing intents this belongs to. If none, propose a new intent.\n\nActive intents:\n${JSON.stringify(activeIntents, null, 2)}\n\nInput:\n${JSON.stringify(input, null, 2)}`
	const raw = await generate(prompt)
	console.log('[jaensen] dispatcher:raw-output', raw.slice(0, 500))
	const parsed = tryParseJson<DispatcherRoutingDecision & { createIntent?: { title: string; summary: string } | null }>(raw)
	if (parsed) {
		console.log('[jaensen] dispatcher:parsed-json', parsed)
		return {
			relevantIntentIds: Array.isArray(parsed.relevantIntentIds) ? parsed.relevantIntentIds : [],
			createIntent: parsed.createIntent ?? undefined
		}
	}

	const matchedIntent = findHeuristicIntentMatch(input.message, activeIntents)
	if (matchedIntent) {
		console.log('[jaensen] dispatcher:heuristic-match', { intentId: matchedIntent.id, title: matchedIntent.title })
		return { relevantIntentIds: [matchedIntent.id] }
	}

	console.log('[jaensen] dispatcher:heuristic-create', {
		title: heuristicTitle(input.message),
		summary: heuristicSummary(input.message)
	})
	return {
		relevantIntentIds: [],
		createIntent: {
			title: heuristicTitle(input.message),
			summary: heuristicSummary(input.message)
		}
	}
}

export async function resolveRelevantIntents(deps: RuntimeDependencies, routing: DispatcherRoutingDecision): Promise<IntentRecord[]> {
	const now = deps.now ?? new Date()
	const intents: IntentRecord[] = []
	for (const id of routing.relevantIntentIds ?? []) {
		const intent = await deps.storage.intents.getById(id)
		if (intent) intents.push(intent)
	}
	if (intents.length === 0) {
		const created = createIntentRecord(routing.createIntent?.title ?? 'New Intent', routing.createIntent?.summary ?? 'New topic', now)
		await deps.storage.intents.save(created)
		console.log('[jaensen] dispatcher:intent-created', { id: created.id, title: created.title })
		intents.push(created)
	}
	return intents
}

function tryParseJson<T>(raw: string): T | null {
	for (const candidate of extractJsonCandidates(stripThinking(raw))) {
		try {
			return JSON.parse(candidate) as T
		} catch {
			continue
		}
	}
	return null
}

function stripThinking(raw: string): string {
	return raw.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
}

function extractJsonCandidates(raw: string): string[] {
	const candidates = [raw]
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]
		if (ch !== '{' && ch !== '[') continue
		const extracted = extractBalanced(raw, i)
		if (extracted) candidates.push(extracted)
	}
	return [...new Set(candidates)]
}

function extractBalanced(raw: string, start: number): string | null {
	const open = raw[start]
	const close = open === '{' ? '}' : ']'
	let depth = 0
	let inString = false
	let escaping = false
	for (let i = start; i < raw.length; i++) {
		const ch = raw[i]
		if (inString) {
			if (escaping) escaping = false
			else if (ch === '\\') escaping = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === open) depth += 1
		if (ch === close) {
			depth -= 1
			if (depth === 0) return raw.slice(start, i + 1)
		}
	}
	return null
}

function findHeuristicIntentMatch(message: string, intents: IntentRecord[]): IntentRecord | undefined {
	const normalized = message.toLowerCase()
	const idMatch = normalized.match(/(?:order|invoice|project|case)\s*#?[-a-z0-9]+/gi)?.[0]?.toLowerCase()
	return intents.find((intent) => {
		const haystack = `${intent.title} ${intent.summary}`.toLowerCase()
		return idMatch ? haystack.includes(idMatch) : overlapScore(normalized, haystack) >= 2
	})
}

function overlapScore(a: string, b: string): number {
	const words = a.split(/[^a-z0-9]+/i).filter((word) => word.length >= 4)
	return words.filter((word) => b.includes(word)).length
}

function heuristicTitle(message: string): string {
	const id = message.match(/(?:order|invoice|project|case)\s*#?[-A-Za-z0-9]+/i)?.[0]
	if (id) return id.replace(/\s+/g, ' ').trim()
	const line = message.split('\n').find((part) => part.trim().length > 0)?.trim() ?? 'New Intent'
	return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

function heuristicSummary(message: string): string {
	const compact = message.replace(/\s+/g, ' ').trim()
	return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact
}