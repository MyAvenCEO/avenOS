import type { DispatcherBrain } from '@jaensen/conversation-actors'

import { buildDispatcherPrompt } from './conversation-prompts'
import { flueDispatcherOutputSchema, normalizeFlueResponseData, validateDispatcherDecision } from './conversation-schemas'
import { createDispatcherSessionName } from './session-names'
import type { CreateFlueDispatcherBrainInput } from './types'
import { toFlueBrainModelError } from './errors'

export function createFlueDispatcherBrain(input: CreateFlueDispatcherBrainInput): DispatcherBrain {
	return {
		async route({ state, envelope, userInput }) {
			const session = await input.harness.session(createDispatcherSessionName(), {
				role: 'jaensen-conversation-dispatcher'
			})

			const prompt = buildDispatcherPrompt({ state, envelope, userInput })

			try {
				const response = await session.prompt(prompt, {
					schema: flueDispatcherOutputSchema,
					role: 'jaensen-conversation-dispatcher',
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})

				return validateDispatcherDecision(normalizeFlueResponseData(response), state)
			} catch (error) {
				throw toFlueBrainModelError('Flue dispatcher route failed', error)
			}
		}
	}
}