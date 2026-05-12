type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

type FlueSessionAdapter = {
	prompt(text: string, options: {
		schema: unknown
		role?: string
		model?: string
		thinkingLevel?: string
	}): Promise<unknown>
	task(text: string, options: {
		schema: unknown
		cwd?: string
		role?: string
		model?: string
		thinkingLevel?: string
	}): Promise<unknown>
}

export type FlueHarnessAdapter = {
	session(name: string, options?: { role?: string }): Promise<FlueSessionAdapter>
}

export interface ProviderConfig {
	provider: 'openai' | 'tinfoil'
	model: string
	baseUrl: string
	apiKey: string
}

type EnvLike = Record<string, string | undefined>

const DEFAULT_OPENAI_BASE_URL = 'http://box:8000/v1'
const DEFAULT_OPENAI_MODEL = 'minimax-m2.7-nvfp4'
const DEFAULT_TINFOIL_BASE_URL = 'https://api.tinfoil.sh/v1'
const DEFAULT_TINFOIL_MODEL = 'glm-5-1'

export function createDevHarness(config: ProviderConfig): FlueHarnessAdapter {
	return {
		async session(name, sessionOptions) {
			return {
				prompt(text, options) {
					return runModelCall({
						config,
						sessionName: name,
						sessionRole: sessionOptions?.role,
						text,
						role: options.role,
						model: options.model,
						thinkingLevel: normalizeThinkingLevel(options.thinkingLevel),
						cwd: undefined,
						mode: 'prompt'
					})
				},
				task(text, options) {
					return runModelCall({
						config,
						sessionName: name,
						sessionRole: sessionOptions?.role,
						text,
						role: options.role,
						model: options.model,
						thinkingLevel: normalizeThinkingLevel(options.thinkingLevel),
						cwd: options.cwd,
						mode: 'task'
					})
				}
			}
		}
	}
}

export function resolveProviderConfig(env: EnvLike): ProviderConfig {
	const hasTinfoil = hasAnyConfigured(env, ['JAENSEN_TINFOIL_API_KEY', 'JAENSEN_TINFOIL_BASE_URL', 'JAENSEN_TINFOIL_MODEL'])
	const hasOpenAi = hasAnyConfigured(env, ['JAENSEN_OPENAI_API_KEY', 'JAENSEN_OPENAI_BASE_URL', 'JAENSEN_OPENAI_MODEL'])

	if (hasTinfoil && hasOpenAi) {
		throw new Error(
			'Jaensen provider configuration is ambiguous. Configure exactly one provider prefix: JAENSEN_TINFOIL_* or JAENSEN_OPENAI_*.'
		)
	}

	if (hasTinfoil) {
		const apiKey = env.JAENSEN_TINFOIL_API_KEY?.trim()
		if (!apiKey) {
			throw new Error('Jaensen Tinfoil configuration requires JAENSEN_TINFOIL_API_KEY.')
		}

		return {
			provider: 'tinfoil',
			model: env.JAENSEN_TINFOIL_MODEL?.trim() || DEFAULT_TINFOIL_MODEL,
			baseUrl: normalizeTinfoilBaseUrl(env.JAENSEN_TINFOIL_BASE_URL?.trim() || DEFAULT_TINFOIL_BASE_URL),
			apiKey
		}
	}

	if (hasOpenAi) {
		return {
			provider: 'openai',
			model: env.JAENSEN_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
			baseUrl: normalizeOpenAiBaseUrl(env.JAENSEN_OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL),
			apiKey: env.JAENSEN_OPENAI_API_KEY?.trim() || 'local'
		}
	}

	throw new Error(
		'No Jaensen model provider is configured. Set either JAENSEN_TINFOIL_API_KEY (optionally JAENSEN_TINFOIL_BASE_URL / JAENSEN_TINFOIL_MODEL) or JAENSEN_OPENAI_BASE_URL / JAENSEN_OPENAI_API_KEY / JAENSEN_OPENAI_MODEL.'
	)
}

export function normalizeTinfoilBaseUrl(value: string): string {
	const trimmed = value.replace(/\/+$/, '')
	return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

export function normalizeOpenAiBaseUrl(value: string): string {
	return value.replace(/\/+$/, '')
}

function hasAnyConfigured(env: EnvLike, keys: string[]): boolean {
	return keys.some((key) => Boolean(env[key]?.trim()))
}

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
	return value === 'off' || value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

async function runModelCall(input: {
	config: ProviderConfig
	sessionName: string
	sessionRole?: string
	text: string
	role?: string
	model?: string
	thinkingLevel: ThinkingLevel
	cwd?: string
	mode: 'prompt' | 'task'
}): Promise<unknown> {
	const system = buildSystemPrompt(input)
	const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${input.config.apiKey}`
		},
		body: JSON.stringify({
			model: input.model || input.config.model,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: input.text }
			]
		})
	})

	if (!response.ok) {
		throw new Error(`Flue model request failed (${response.status} ${response.statusText}): ${await response.text()}`)
	}

	const body = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
	}

	const content = readMessageContent(body)
	if (!content) {
		throw new Error('Flue model returned no message content.')
	}

	return normalizeStructuredResult(parseJsonObject(content), input.role || input.sessionRole)
}

function buildSystemPrompt(input: {
	config: ProviderConfig
	sessionName: string
	sessionRole?: string
	role?: string
	thinkingLevel: ThinkingLevel
	cwd?: string
	mode: 'prompt' | 'task'
}): string {
	const lines = [
		'You are serving a Jaensen Flue session.',
		`Provider: ${input.config.provider}`,
		`Session: ${input.sessionName}`,
		`Role: ${input.role || input.sessionRole || 'unspecified'}`,
		`Thinking level: ${input.thinkingLevel}`,
		input.mode === 'task'
			? 'This request came from Flue task(). Solve it as a structured task response, but you do not have tool execution in this adapter.'
			: 'This request came from Flue prompt().',
		input.cwd ? `Working directory hint: ${input.cwd}` : null,
		buildRoleOutputContract(input.role || input.sessionRole),
		'Return exactly one valid JSON object and no surrounding prose or markdown fences.'
	]

	return lines.filter((line): line is string => Boolean(line)).join('\n')
}

function readMessageContent(body: {
	choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
}): string {
	const content = body.choices?.[0]?.message?.content
	if (typeof content === 'string') {
		return content
	}

	if (Array.isArray(content)) {
		return content
			.map((item) => (typeof item.text === 'string' ? item.text : ''))
			.join('')
			.trim()
	}

	return ''
}

function parseJsonObject(content: string): unknown {
	const trimmed = content.trim()
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
	const candidate = fenced?.[1]?.trim() || trimmed
	return JSON.parse(candidate)
}

function buildRoleOutputContract(role: string | undefined): string | null {
	if (role === 'jaensen-conversation-dispatcher') {
		return [
			'DISPATCHER OUTPUT CONTRACT:',
			'- Return an object with type exactly equal to "route_existing_intent" or "create_intent".',
			'- If type is "route_existing_intent", return exactly: {"type":"route_existing_intent","intentId":"<existing-intent-id>","reason":"<short reason>"}',
			'- If type is "create_intent", return exactly: {"type":"create_intent","title":"<short title>","initialGoal":"<goal>","reason":"<short reason>"}',
			'- Do not return reply_user, actions arrays, markdown, analysis, or any wrapper keys like decision/result/data.'
		].join('\n')
	}

	if (role === 'jaensen-conversation-intent') {
		return [
			'INTENT OUTPUT CONTRACT:',
			'- Return one object with top-level keys: state, optional events, optional actions.',
			'- Do not wrap the result in data/result/decision.'
		].join('\n')
	}

	return null
}

function normalizeStructuredResult(value: unknown, role: string | undefined): unknown {
	const unwrapped = unwrapCommonResultWrappers(value)

	if (role === 'jaensen-conversation-dispatcher') {
		return normalizeDispatcherResult(unwrapped)
	}

	if (role === 'jaensen-conversation-intent') {
		return normalizeIntentResult(unwrapped)
	}

	return unwrapped
}

function unwrapCommonResultWrappers(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return value
	}

	const record = value as Record<string, unknown>
	for (const key of ['data', 'result', 'decision', 'output']) {
		const nested = record[key]
		if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
			return nested
		}
	}

	return value
}

function normalizeDispatcherResult(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return value
	}

	const record = value as Record<string, unknown>
	if (record.type === 'route_existing_intent' || record.type === 'create_intent') {
		return value
	}

	const candidateType = firstString(record, ['decisionType', 'kind', 'action'])
	if (candidateType === 'route_existing_intent' || candidateType === 'create_intent') {
		return {
			type: candidateType,
			intentId: firstString(record, ['intentId']),
			title: firstString(record, ['title']),
			initialGoal: firstString(record, ['initialGoal', 'goal']),
			reason: firstString(record, ['reason', 'why'])
		}
	}

	if (typeof record.intentId === 'string' && typeof record.reason === 'string') {
		return {
			type: 'route_existing_intent',
			intentId: record.intentId,
			reason: record.reason
		}
	}

	if (typeof record.title === 'string' && typeof (record.initialGoal ?? record.goal) === 'string') {
		return {
			type: 'create_intent',
			title: record.title,
			initialGoal: typeof record.initialGoal === 'string' ? record.initialGoal : record.goal,
			reason: typeof record.reason === 'string' ? record.reason : 'New user goal'
		}
	}

	return value
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		if (typeof record[key] === 'string' && record[key].trim().length > 0) {
			return record[key] as string
		}
	}

	return undefined
}

function normalizeIntentResult(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return value
	}

	const record = value as Record<string, unknown>
	const state = normalizeIntentState(record.state)
	const explicitActions = normalizeIntentActions(record.actions)
	const rootAction = extractIntentActionFromRecord(record)
	if (rootAction && !explicitActions?.length) {
		console.warn(
			'[jaensen/dev-harness] Recovered intent action from malformed root-level model output; expected action inside actions[].',
			{ type: rootAction.type }
		)
	}
	const actionsFromEvents = extractIntentActionsFromEvents(record.events)
	const actions = [...(explicitActions ?? []), ...(rootAction ? [rootAction] : []), ...actionsFromEvents]

	if (state) {
		return {
			state,
			events: normalizeIntentEvents(record.events),
			actions: actions.length > 0 ? actions : undefined
		}
	}

	if (actions.length > 0) {
		const synthesizedState = synthesizeIntentStateFromRoot(record, actions)
		if (synthesizedState) {
			return {
				state: synthesizedState,
				events: normalizeIntentEvents(record.events),
				actions
			}
		}
	}

	return value
}

function normalizeIntentState(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined
	}

	const state = value as Record<string, unknown>
	const intentId = firstString(state, ['intentId'])
	const title = firstString(state, ['title'])
	const goal = firstString(state, ['goal', 'initialGoal'])
	const status = firstString(state, ['status'])
	const summary = typeof state.summary === 'string' ? state.summary : ''
	const pendingSkillCalls =
		state.pendingSkillCalls && typeof state.pendingSkillCalls === 'object' && !Array.isArray(state.pendingSkillCalls)
			? state.pendingSkillCalls
			: {}

	if (!intentId || !title || !goal || !status) {
		return undefined
	}

	return {
		intentId,
		title,
		goal,
		status,
		summary,
		pendingSkillCalls
	}
}

function synthesizeIntentStateFromRoot(
	record: Record<string, unknown>,
	actions: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
	const intentId = firstString(record, ['intentId'])
	const title = firstString(record, ['title'])
	const goal = firstString(record, ['goal', 'initialGoal'])
	if (!intentId || !title || !goal) {
		return undefined
	}

	let status = firstString(record, ['status']) || 'active'
	if (actions.some((action) => action.type === 'ask_user')) status = 'waiting_for_user'
	if (actions.some((action) => action.type === 'complete')) status = 'completed'
	if (actions.some((action) => action.type === 'fail')) status = 'failed'

	return {
		intentId,
		title,
		goal,
		status,
		summary: typeof record.summary === 'string' ? record.summary : '',
		pendingSkillCalls:
			record.pendingSkillCalls && typeof record.pendingSkillCalls === 'object' && !Array.isArray(record.pendingSkillCalls)
				? record.pendingSkillCalls
				: {}
	}
}

function normalizeIntentActions(value: unknown): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}

	return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function normalizeIntentEvents(value: unknown): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}

	return value
		.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
		.map((event) => ({
			eventType: firstString(event, ['eventType']) || 'event',
			event: 'event' in event ? event.event : event
		}))
}

function extractIntentActionsFromEvents(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) {
		return []
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return []
		}

		const eventRecord = item as Record<string, unknown>
		const candidate =
			eventRecord.event && typeof eventRecord.event === 'object' && !Array.isArray(eventRecord.event)
				? (eventRecord.event as Record<string, unknown>)
				: eventRecord

		const type = firstString(candidate, ['type'])
		const payload =
			candidate.payload && typeof candidate.payload === 'object' && !Array.isArray(candidate.payload)
				? (candidate.payload as Record<string, unknown>)
				: candidate

		switch (type) {
			case 'intent.confirmation_requested': {
				const question = firstString(payload, ['clarification', 'question', 'message'])
				return question ? [{ type: 'ask_user', question }] : []
			}
			case 'reply_user': {
				const message = firstString(payload, ['message'])
				return message ? [{ type: 'reply_user', message }] : []
			}
			case 'ask_user': {
				const question = firstString(payload, ['question', 'message'])
				return question ? [{ type: 'ask_user', question }] : []
			}
			case 'complete': {
				const summary = firstString(payload, ['summary'])
				if (!summary) return []
				const message = firstString(payload, ['message'])
				return [{ type: 'complete', summary, ...(message ? { message } : {}) }]
			}
			case 'fail': {
				const reason = firstString(payload, ['reason', 'summary'])
				if (!reason) return []
				const message = firstString(payload, ['message'])
				return [{ type: 'fail', reason, ...(message ? { message } : {}) }]
			}
			case 'call_skill': {
				const skillId = firstString(payload, ['skillId'])
				const callId = firstString(payload, ['callId'])
				const request = firstString(payload, ['request'])
				if (!skillId || !callId || !request) return []
				return [{ type: 'call_skill', skillId, callId, request, payload: payload.input ?? payload.payload ?? payload }]
			}
			default:
				return []
		}
	})
}

function extractIntentActionFromRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
	const type = firstString(record, ['type', 'action'])
	if (!type) return undefined

	switch (type) {
		case 'reply_user': {
			const message = firstString(record, ['message'])
			return message ? { type, message } : undefined
		}
		case 'ask_user': {
			const question = firstString(record, ['question', 'message'])
			return question ? { type, question } : undefined
		}
		case 'complete': {
			const summary = firstString(record, ['summary'])
			if (!summary) return undefined
			const message = firstString(record, ['message'])
			return { type, summary, ...(message ? { message } : {}) }
		}
		case 'fail': {
			const reason = firstString(record, ['reason', 'summary'])
			if (!reason) return undefined
			const message = firstString(record, ['message'])
			return { type, reason, ...(message ? { message } : {}) }
		}
		case 'call_skill': {
			const skillId = firstString(record, ['skillId'])
			const callId = firstString(record, ['callId'])
			const request = firstString(record, ['request'])
			if (!skillId || !callId || !request) return undefined
			return {
				type,
				skillId,
				callId,
				request,
				payload: record.payload ?? record.input ?? {}
			}
		}
		default:
			return undefined
	}
}