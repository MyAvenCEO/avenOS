import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { routeInputToIntents, resolveRelevantIntents } from './dispatcher.js'
import { appendIntentEvent } from './intent.js'
import { runExtractSkill } from './skills/extract.js'
import { runIngestSkill } from './skills/ingest.js'
import { runMemorySkill } from './skills/memory.js'
import type { IntentRecord } from '../storage/types.js'
import type { IntentDecision, JaensenInput, RegisteredSkill, RunResult, RuntimeDependencies, SkillAction, SkillRegistry, SkillResult } from './types.js'

const SUPPORTED_SKILL_OPERATIONS = {
	memory: ['remember', 'recall', 'search'],
	ingest: ['archive-url', 'archive-attachment'],
	extract: ['extract-text', 'extract-entities']
} as const

function normalizeSkillAction(action: unknown, skillRegistry: SkillRegistry): SkillAction | null {
	if (!action || typeof action !== 'object') return null
	const record = action as Record<string, unknown>
	const skill = record.skill
	const operation = record.operation
	const input = record.input
	if (typeof skill !== 'string') return null
	const registeredSkill = skillRegistry[skill]
	if (!registeredSkill || !registeredSkill.runtimeSupported) return null
	if (!isValidOperation(registeredSkill, operation)) return null
	return {
		skill,
		operation,
		input: input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
	}
}


function isValidOperation(skill: RegisteredSkill, operation: unknown): operation is string {
	if (typeof operation !== 'string') return false
	return skill.operations.includes(operation)
}

export async function runJaensenTurn(input: JaensenInput, deps: RuntimeDependencies): Promise<RunResult> {
	const promptSafeInput = sanitizeInputForLlm(input)
	console.log('[jaensen] turn:start', {
		from: input.from,
		subject: input.subject,
		messagePreview: input.message.slice(0, 160),
		hasAttachment: Boolean(input.attachment)
	})
	console.log('[jaensen] skills:available', Object.values(deps.skillRegistry).map((skill) => ({
		id: skill.id,
		description: skill.description,
		operations: skill.operations,
		runtimeSupported: skill.runtimeSupported
	})))
	const activeIntents = await deps.storage.intents.listActive()
	console.log('[jaensen] intents:active', activeIntents.map((intent) => ({ id: intent.id, title: intent.title, status: intent.status })))
	const routing = await routeInputToIntents(promptSafeInput, activeIntents, deps.generate)
	console.log('[jaensen] routing:result', routing)
	const relevantIntents = await resolveRelevantIntents(deps, routing)
	const primaryIntent = relevantIntents[0]
	console.log('[jaensen] intent:selected', {
		primary: primaryIntent?.id,
		relevant: relevantIntents.map((intent) => ({ id: intent.id, title: intent.title }))
	})

	appendIntentEvent(primaryIntent, {
		timestamp: (deps.now ?? new Date()).toISOString(),
		source: 'user',
		type: 'input_received',
		data: { from: input.from, subject: input.subject, message: input.message }
	})

	const intentDecision = await decideIntent(primaryIntent, promptSafeInput, deps)
	console.log('[jaensen] intent:decision', {
		intentId: primaryIntent.id,
		summary: intentDecision.summary,
		status: intentDecision.status,
		actionCount: intentDecision.actions.length,
		actions: intentDecision.actions,
		humanLoop: intentDecision.humanLoop
	})
	const skillResults = await executeActions(primaryIntent, input, intentDecision, deps)
	console.log('[jaensen] skills:results', skillResults)
	for (const skillResult of skillResults) {
		appendIntentEvent(primaryIntent, {
			timestamp: new Date().toISOString(),
			source: 'skill',
			type: `${skillResult.skill}_completed`,
			data: {
				skill: skillResult.skill,
				ok: skillResult.ok,
				summary: skillResult.summary,
				...(skillResult.data ?? {})
			}
		})
	}
	appendIntentEvent(primaryIntent, {
		timestamp: new Date().toISOString(),
		source: 'system',
		type: 'intent_decision_applied',
		data: { actions: intentDecision.actions, skillResults }
	})
	primaryIntent.summary = intentDecision.summary
	primaryIntent.status = intentDecision.status ?? primaryIntent.status
	primaryIntent.context = { ...primaryIntent.context, ...(intentDecision.contextUpdates ?? {}) }
	primaryIntent.humanLoop = intentDecision.humanLoop
	primaryIntent.updatedAt = new Date().toISOString()
	await deps.storage.intents.save(primaryIntent)

	const response = await synthesizeFinalResponse(primaryIntent, promptSafeInput, intentDecision, skillResults, deps.generate)
	appendIntentEvent(primaryIntent, {
		timestamp: new Date().toISOString(),
		source: 'system',
		type: 'response_ready',
		data: {
			reply: response,
			awaitingHuman: primaryIntent.status !== 'resolved'
		}
	})
	await deps.storage.intents.save(primaryIntent)
	console.log('[jaensen] turn:done', {
		intentId: primaryIntent.id,
		status: primaryIntent.status,
		humanNotification: primaryIntent.humanLoop?.message,
		responsePreview: response.slice(0, 160)
	})
	return {
		response,
		routing,
		primaryIntent,
		relevantIntents,
		intentDecision,
		skillResults,
		humanNotification: primaryIntent.humanLoop?.needed ? primaryIntent.humanLoop.message : undefined
	}
}

function sanitizeInputForLlm(input: JaensenInput): JaensenInput {
	if (!input.attachment) return input
	const { base64: _base64, ...attachment } = input.attachment
	return {
		...input,
		attachment
	}
}

export async function loadSkillRegistry(baseDir: string): Promise<SkillRegistry> {
	console.log('[jaensen] skills:load-registry', { baseDir })
	const skillsDir = join(baseDir, '.flue/skills')
	const entries = await readdir(skillsDir, { withFileTypes: true })
	const registryEntries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
		const doc = await readFile(join(skillsDir, entry.name, 'SKILL.md'), 'utf-8')
		console.log('[jaensen] skill:doc', { skill: entry.name, doc: doc.slice(0, 160) })
		const meta = parseSkillDoc(doc)
		const supportedOperations = SUPPORTED_SKILL_OPERATIONS[entry.name as keyof typeof SUPPORTED_SKILL_OPERATIONS] ?? []
		return [entry.name, {
			id: meta.name ?? entry.name,
			description: meta.description,
			doc,
			operations: [...supportedOperations],
			runtimeSupported: supportedOperations.length > 0
		} satisfies RegisteredSkill] as const
	}))
	return Object.fromEntries(registryEntries)
}

export async function loadSkillDocs(baseDir: string): Promise<Record<'memory' | 'ingest' | 'extract', string>> {
	const registry = await loadSkillRegistry(baseDir)
	return {
		memory: registry.memory?.doc ?? '',
		ingest: registry.ingest?.doc ?? '',
		extract: registry.extract?.doc ?? ''
	}
}

async function decideIntent(intent: IntentRecord, input: JaensenInput, deps: RuntimeDependencies): Promise<IntentDecision> {
	const memoryContext = await deps.storage.memory.search(input.message)
	const availableSkills = Object.values(deps.skillRegistry).map((skill) => ({
		skill: skill.id,
		description: skill.description,
		operations: skill.operations,
		runtimeSupported: skill.runtimeSupported
	}))
	console.log('[jaensen] intent:available-tools', {
		intentId: intent.id,
		availableSkills
	})
	const prompt = `INTENT_DECISION\nYou are the intent responsible for advancing this topic. Return strict JSON with shape {"summary": string, "status": "active"|"pending"|"resolved", "contextUpdates": object, "actions": SkillAction[], "humanLoop": {"needed": boolean, "reason": string, "message": string}, "replyDraft": string}.\nOnly reference skills from Available skills. Do not invent new skills or operations.\n\nAvailable skills:\n${JSON.stringify(availableSkills, null, 2)}\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nRelevant memory:\n${JSON.stringify(memoryContext, null, 2)}\n\nInput:\n${JSON.stringify(input, null, 2)}`
	const raw = await deps.generate(prompt)
	console.log('[jaensen] intent:raw-output', raw.slice(0, 500))
	const parsed = tryParseJson<IntentDecision>(raw)
	if (parsed && looksLikeIntentDecision(parsed)) {
		return sanitizeIntentDecision(enrichIntentDecision(input, intent, {
			summary: parsed.summary || intent.summary,
			status: parsed.status,
			contextUpdates: parsed.contextUpdates ?? {},
			actions: Array.isArray(parsed.actions) ? parsed.actions.map((action) => normalizeSkillAction(action, deps.skillRegistry)).filter((action): action is SkillAction => action !== null) : [],
			humanLoop: parsed.humanLoop,
			replyDraft: parsed.replyDraft || 'Received.'
		}))
	}
	const toolCallDecision = tryParseToolCallIntentDecision(raw, deps.skillRegistry)
	if (toolCallDecision) {
		console.log('[jaensen] intent:parsed-tool-call', toolCallDecision)
		return sanitizeIntentDecision(enrichIntentDecision(input, intent, toolCallDecision))
	}
	const fallbackDecision = sanitizeIntentDecision(enrichIntentDecision(input, intent, heuristicIntentDecision(intent, input)))
	console.log('[jaensen] intent:heuristic-decision', {
		intentId: intent.id,
		actions: fallbackDecision.actions,
		humanLoop: fallbackDecision.humanLoop
	})
	return fallbackDecision
}

function looksLikeIntentDecision(value: IntentDecision | Record<string, unknown>): value is IntentDecision {
	return (
		typeof value === 'object' &&
		value !== null &&
		(
			typeof (value as Record<string, unknown>).replyDraft === 'string' ||
			typeof (value as Record<string, unknown>).summary === 'string' ||
			Array.isArray((value as Record<string, unknown>).actions) ||
			typeof (value as Record<string, unknown>).humanLoop === 'object'
		)
	)
}

function sanitizeIntentDecision(decision: IntentDecision): IntentDecision {
	if (!decision.humanLoop?.needed) return decision
	if ((decision.actions?.length ?? 0) === 0) return decision
	const reason = decision.humanLoop.reason?.toLowerCase() ?? ''
	const message = decision.humanLoop.message?.toLowerCase() ?? ''
	if (reason.includes('awaiting_') || reason.includes('processing') || message.includes('extracting') || message.includes('processing')) {
		return {
			...decision,
			humanLoop: { needed: false }
		}
	}
	return decision
}

async function executeActions(intent: IntentRecord, input: JaensenInput, decision: IntentDecision, deps: RuntimeDependencies): Promise<SkillResult[]> {
	const results: SkillResult[] = []
	const queue: SkillAction[] = [...(decision.actions ?? [])]
	for (let index = 0; index < queue.length; index += 1) {
		const action = queue[index]
		console.log('[jaensen] skill:dispatch', { intentId: intent.id, action })
		let result: SkillResult
		if (action.skill === 'memory') result = await runMemorySkill(intent, action, deps)
		else if (action.skill === 'ingest') result = await runIngestSkill(input, intent, action, deps)
		else if (action.skill === 'extract') result = await runExtractSkill(intent, action, deps)
		else result = { skill: action.skill, ok: false, summary: `Skill ${action.skill} is registered but has no runtime executor` }
		console.log('[jaensen] tool:result', {
			intentId: intent.id,
			skill: result.skill,
			ok: result.ok,
			summary: result.summary,
			data: result.data
		})
		results.push(result)
		if (action.skill === 'ingest' && result.ok) {
			const archiveKey = typeof result.data?.key === 'string' ? result.data.key : undefined
			const existingExtract = queue.some((candidate, candidateIndex) => candidateIndex > index && candidate.skill === 'extract' && (candidate.input.key === archiveKey || candidate.input.archiveKey === archiveKey))
			if (archiveKey && !existingExtract) {
				const contentType = typeof action.input.contentType === 'string'
					? action.input.contentType
					: typeof input.attachment?.contentType === 'string'
						? input.attachment.contentType
						: undefined
				const queuedExtract: SkillAction = {
					skill: 'extract',
					operation: 'extract-text',
					input: {
						archiveKey,
						...(contentType ? { contentType } : {})
					}
				}
				console.log('[jaensen] dispatcher:queue-followup-skill', {
					intentId: intent.id,
					trigger: 'ingest-complete',
					action: queuedExtract
				})
				queue.push(queuedExtract)
			}
		}
	}
	return results
}

async function synthesizeFinalResponse(intent: IntentRecord, input: JaensenInput, decision: IntentDecision, skillResults: SkillResult[], generate: (prompt: string) => Promise<string>) {
	const prompt = `FINAL_RESPONSE\nReturn strict JSON {"reply": string}. If you fail to return JSON, plain text is acceptable.\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nDecision:\n${JSON.stringify(decision, null, 2)}\n\nSkill results:\n${JSON.stringify(skillResults, null, 2)}\n\nInput:\n${JSON.stringify(input, null, 2)}`
	const raw = await generate(prompt)
	console.log('[jaensen] response:raw-output', raw.slice(0, 500))
	try {
		return parseJson<{ reply: string }>(raw).reply || decision.replyDraft
	} catch {
		return stripThinking(raw).trim() || decision.replyDraft
	}
}

function parseSkillDoc(doc: string): { name?: string; description?: string } {
	const match = doc.match(/^---\n([\s\S]*?)\n---/)
	if (!match) return {}
	const meta: { name?: string; description?: string } = {}
	for (const line of match[1].split('\n')) {
		const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
		if (!fieldMatch) continue
		const [, key, value] = fieldMatch
		if (key === 'name') meta.name = value.trim()
		if (key === 'description') meta.description = value.trim()
	}
	return meta
}

function parseJson<T>(raw: string): T {
	const parsed = tryParseJson<T>(raw)
	if (parsed !== null) return parsed
	throw new Error(`Could not parse JSON from model output: ${stripThinking(raw).slice(0, 400)}`)
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

function tryParseToolCallIntentDecision(raw: string, skillRegistry: SkillRegistry): IntentDecision | null {
	const stripped = stripThinking(raw)
	const match = stripped.match(/\[TOOL_CALL\][\s\S]*?tool\s*=>\s*"([^"]+)"[\s\S]*?--operation\s+"([^"]+)"[\s\S]*?--input\s+(\{[\s\S]*?\})[\s\S]*?\[\/TOOL_CALL\]/i)
	if (!match) return null
	const [, skill, operation, inputJson] = match
	let input: Record<string, unknown> = {}
	try {
		input = JSON.parse(inputJson) as Record<string, unknown>
	} catch {
		return null
	}
	const action = normalizeSkillAction({ skill, operation, input }, skillRegistry)
	if (!action) return null
	const summary = stripped.split('[TOOL_CALL]')[0]?.replace(/\s+/g, ' ').trim() || 'Intent selected a tool action.'
	return {
		summary,
		status: 'active',
		contextUpdates: {},
		actions: [action],
		humanLoop: { needed: false },
		replyDraft: 'Received.'
	}
}

function heuristicIntentDecision(intent: IntentRecord, input: JaensenInput): IntentDecision {
	const message = input.message
	const urls = [...message.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0])
	const lower = message.toLowerCase()
	const actions: IntentDecision['actions'] = []
	if (lower.includes('remember')) {
		actions.push({
			skill: 'memory',
			operation: 'remember',
			input: { topic: intent.title, note: message }
		})
	}
	for (const url of urls) {
		actions.push({ skill: 'ingest', operation: 'archive-url', input: { url } })
	}
	if (input.attachment) {
		actions.push({
			skill: 'ingest',
			operation: 'archive-attachment',
			input: {
				name: input.attachment.name,
				contentType: input.attachment.contentType
			}
		})
	}
	return {
		summary: message.replace(/\s+/g, ' ').trim().slice(0, 180),
		status: 'active',
		contextUpdates: {},
		actions,
		humanLoop: { needed: false },
		replyDraft: `Received. Working on ${intent.title}.`
	}
}

function enrichIntentDecision(input: JaensenInput, intent: IntentRecord, decision: IntentDecision): IntentDecision {
	const fallback = heuristicIntentDecision(intent, input)
	const existing = new Set(decision.actions.map((action) => `${action.skill}:${action.operation}:${JSON.stringify(action.input)}`))
	const merged = [...decision.actions]
	for (const action of fallback.actions) {
		const key = `${action.skill}:${action.operation}:${JSON.stringify(action.input)}`
		if (!existing.has(key)) {
			existing.add(key)
			merged.push(action)
		}
	}
	return {
		...decision,
		actions: merged,
		replyDraft: decision.replyDraft || fallback.replyDraft,
		summary: decision.summary || fallback.summary
	}
}