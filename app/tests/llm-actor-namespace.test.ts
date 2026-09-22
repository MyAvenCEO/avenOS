import { MessageBus } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import { LlmActor } from '../src/lib/actors/llm.actor'

describe('LLM actor ownership', () => {
	test('keeps every LLM invocation contract in the avenCEO application domain', () => {
		const actor = new LlmActor(async () => 'ok')

		expect(actor.manifest).toMatchObject({
			authority: 'ceo.aven',
			namespace: 'ai.gateway',
			tags: expect.arrayContaining(['application', 'llm'])
		})
	})
	test('private native transport does not advertise the artifact completion contract', async () => {
		const actor = new LlmActor(async (_system, question) => question)
		const bus = new MessageBus()
		bus.register(actor)
		expect(bus.toolSpecs()).toEqual([])
		expect(actor.handles('llm_complete')).toBe(false)
		expect(await bus.llmLane()!('system', 'test')).toBe('test')
	})
})
