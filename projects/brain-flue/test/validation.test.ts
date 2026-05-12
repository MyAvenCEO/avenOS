import { expect, test } from 'bun:test'

import {
	FlueBrainValidationError,
	skillSupervisorDecisionSchema,
	skillWorkerResultSchema,
	validateSupervisorDecision,
	validateWorkerResult
} from '../src/index'

test('invalid supervisor action is rejected', () => {
	expect(() =>
		validateSupervisorDecision(
			{
				state: {},
				actions: [{ type: 'explode', payload: {} }]
			},
			'intent/1'
		)
	).toThrow(FlueBrainValidationError)
})

test('supervisor cannot send to human', () => {
	expect(() =>
		validateSupervisorDecision(
			{
				state: {},
				actions: [{ type: 'send', to: 'human', messageType: 'x', payload: {} }]
			},
			'intent/1'
		)
	).toThrow('supervisor may not send to human')

	expect(() =>
		validateSupervisorDecision(
			{
				state: {},
				actions: [{ type: 'reply', messageType: 'x', payload: {} }]
			},
			'human'
		)
	).toThrow('supervisor may not send to human')
})

test('worker result requires state', () => {
	expect(() => validateWorkerResult({ completed: true })).toThrow(FlueBrainValidationError)
})

test('schemas reject malformed llm output', () => {
	expect(skillSupervisorDecisionSchema.safeParse({ state: {}, actions: [{ type: 'route_worker', workerId: 'bad id', messageType: '', payload: {} }] }).success).toBe(false)
	expect(skillWorkerResultSchema.safeParse({ result: {} }).success).toBe(false)
})