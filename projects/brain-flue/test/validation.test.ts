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

test('worker result defaults missing state to empty object', () => {
	expect(validateWorkerResult({ completed: true })).toMatchObject({ state: {}, completed: true })
})

test('supervisor decision defaults missing state to empty object', () => {
	expect(validateSupervisorDecision({ actions: [] }, 'intent/1')).toMatchObject({ state: {}, actions: [] })
})

test('schemas reject malformed llm output', () => {
	expect(skillSupervisorDecisionSchema.safeParse({ state: {}, actions: [{ type: 'route_worker', workerId: 'bad id', messageType: '', payload: {} }] }).success).toBe(false)
	expect(skillWorkerResultSchema.safeParse({ result: {} }).success).toBe(true)
})

test('supervisor schema accepts call_skill', () => {
	expect(skillSupervisorDecisionSchema.safeParse({
		state: {},
		actions: [{ type: 'call_skill', to: 'skill/memory', callId: 'call-1', request: 'Remember', payload: {} }]
	}).success).toBe(true)
})

test('worker schema accepts call_skill action', () => {
	expect(skillWorkerResultSchema.safeParse({
		state: {},
		actions: [{ type: 'call_skill', to: 'skill/memory', callId: 'call-1', request: 'Remember', payload: {} }]
	}).success).toBe(true)
})

test('schema rejects call_skill without callId', () => {
	expect(skillSupervisorDecisionSchema.safeParse({
		state: {},
		actions: [{ type: 'call_skill', to: 'skill/memory', request: 'Remember', payload: {} }]
	}).success).toBe(false)
})

test('schema rejects call_skill without request', () => {
	expect(skillWorkerResultSchema.safeParse({
		state: {},
		actions: [{ type: 'call_skill', to: 'skill/memory', callId: 'call-1', payload: {} }]
	}).success).toBe(false)
})