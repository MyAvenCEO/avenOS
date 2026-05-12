import type { IntentBrain, IntentBrainDecision } from '@jaensen/conversation-actors'

import { buildIntentPrompt } from './conversation-prompts'
import { flueIntentOutputSchema, normalizeFlueResponseData, validateIntentDecision } from './conversation-schemas'
import { toFlueBrainModelError } from './errors'
import { createIntentSessionName } from './session-names'
import type { CreateFlueIntentBrainInput } from './types'

export function createFlueIntentBrain(input: CreateFlueIntentBrainInput): IntentBrain {
	return {
		async decide({ state, envelope, availableSkills, signal }) {
			const session = await input.harness.session(createIntentSessionName(state.intentId), {
				role: 'jaensen-conversation-intent'
			})

			const prompt = buildIntentPrompt({ state, envelope, availableSkills })

			try {
				return await decideWithRepair({
					session,
					prompt,
					state,
					envelope,
					availableSkills,
					model: input.model,
					thinkingLevel: input.thinkingLevel,
					signal
				})
			} catch (error) {
				throw toFlueBrainModelError(`Flue intent decide failed for intent ${state.intentId}`, error)
			}
		}
	}
}

async function decideWithRepair(input: {
	session: Awaited<ReturnType<CreateFlueIntentBrainInput['harness']['session']>>
	prompt: string
	state: Parameters<IntentBrain['decide']>[0]['state']
	envelope: Parameters<IntentBrain['decide']>[0]['envelope']
	availableSkills: Parameters<IntentBrain['decide']>[0]['availableSkills']
	model?: string
	thinkingLevel?: string
	signal?: AbortSignal
}): Promise<IntentBrainDecision> {
	const validationContext = {
		state: input.state,
		envelope: input.envelope,
		availableSkillIds: new Set(input.availableSkills.map((skill) => skill.id))
	}

	let lastValidationError = 'Unknown validation error'

	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await input.session.prompt(
			attempt === 0
				? input.prompt
				: [
					input.prompt,
					'',
					'Your previous response was invalid.',
					`Validation errors: ${lastValidationError}`,
					'Return exactly one JSON object with only optional summary, optional events, and optional actions.'
				].join('\n'),
			{
				schema: flueIntentOutputSchema,
				role: 'jaensen-conversation-intent',
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				signal: input.signal
			}
		)

		try {
			return validateIntentDecision(normalizeFlueResponseData(response), validationContext)
		} catch (error) {
			lastValidationError = error instanceof Error ? error.message : String(error)
		}
	}

	return {
		summary: input.state.summary,
		events: [{ eventType: 'intent.brain.invalid_output', event: { error: lastValidationError } }],
		actions: [
			{
				type: 'ask_user',
				question: 'I had trouble deciding the next step. Please restate what you want me to do.'
			}
		]
	}
}