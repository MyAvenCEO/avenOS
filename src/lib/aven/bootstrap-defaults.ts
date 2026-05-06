import { WORKER_CATEGORY_KEYS } from '../worker-catalog'

export const defaultForcedToolName = 'classify_intent'

/** Tinfoil model id — override via snapshot if needed. */
export const defaultModel = 'llama3-3-70b'

export const defaultTemperature = 0.1

export const defaultResponses = {
	responsesMissingApiKey: 'Maia needs TINFOIL_API_KEY on the server.',
	responsesNoToolCalls: 'Maia did not return a classification tool call.',
	responsesInvalidBody: 'Maia returned an invalid classify_intent payload.'
} as const

export const defaultUserIntentTemplate =
	'User intent (one line title):\n{{intent}}\n\nPick worker_class from the enum. Use worker_mode "select" when an existing domain fits; use "spawn" when the user implies a new specialist worker.'

export const defaultSystemPrompt = `You route user intents for Aven Maia.

Always call classify_intent exactly once.

worker_class must be one of: ${WORKER_CATEGORY_KEYS.join(', ')}.
- calendar: scheduling, meetings, reminders, time zones
- finance: money, budgets, invoices, expenses, taxes
- health: fitness, sleep, medical wellness (not emergency dispatch)
- projects: tasks, delivery, engineering tickets, roadmaps

worker_mode:
- "select": route into an existing catalog bucket (normal case).
- "spawn": user asks for a new automation/agent/worker type — still set worker_class to the closest bucket, and fill spawn_worker_key + spawn_worker_display_name with a short machine id and human label.

request_title: concise headline derived from the intent.
instructions: 1–3 sentences for the worker about what to do next.`

export function defaultToolsJson(): string {
	const workerEnum = [...WORKER_CATEGORY_KEYS]
	const tool = {
		type: 'function',
		function: {
			name: defaultForcedToolName,
			description:
				'Classify the intent for routing: domain bucket (worker_class), select vs spawn, title, and worker-facing instructions.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					worker_mode: { type: 'string', enum: ['select', 'spawn'] },
					worker_class: { type: 'string', enum: workerEnum },
					request_title: { type: 'string' },
					instructions: { type: 'string' },
					spawn_worker_key: {
						type: 'string',
						description: 'snake_case id when worker_mode is spawn'
					},
					spawn_worker_display_name: {
						type: 'string',
						description: 'Human label when worker_mode is spawn'
					}
				},
				required: ['worker_mode', 'worker_class', 'request_title', 'instructions']
			}
		}
	}
	return JSON.stringify([tool])
}

export function defaultInferenceSnapshot() {
	return {
		model: defaultModel,
		temperature: defaultTemperature,
		systemPrompt: defaultSystemPrompt,
		userIntentTemplate: defaultUserIntentTemplate,
		forcedToolName: defaultForcedToolName,
		toolsJson: defaultToolsJson(),
		responsesMissingApiKey: defaultResponses.responsesMissingApiKey,
		responsesNoToolCalls: defaultResponses.responsesNoToolCalls,
		responsesInvalidBody: defaultResponses.responsesInvalidBody
	}
}
