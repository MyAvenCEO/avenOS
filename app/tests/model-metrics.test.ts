import { expect, test } from 'bun:test'
import {
	MAX_MODEL_METRICS,
	modelMetricsFromPayload,
	modelTokenUsage
} from '@avenos/chat-engine/model-metrics'
import { turnPayload } from '@avenos/chat-engine/turn-payload'

test('usage accepts actual nonnegative counts, never guesses or converts missing data to zero', () => {
	expect(
		modelTokenUsage({
			prompt_tokens: 12,
			completion_tokens: 0,
			prompt: 'private'
		})
	).toEqual({
		inputTokens: 12,
		outputTokens: 0
	})
	for (const value of [null, undefined, '12', -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
		expect(modelTokenUsage({ prompt_tokens: value, completion_tokens: value })).toEqual({})
})

test('saved model observations retain only bounded terminal metadata without prompts or provider errors', () => {
	const observation = {
		id: 'synthetic-request',
		phase: 'verification',
		status: 'completed',
		startedAt: 1800000000000,
		durationMs: 12,
		firstTextMs: 8,
		inputTokens: 32,
		outputTokens: 4,
		replayed: true,
		prompt: 'private',
		error: 'private'
	}
	const restored = modelMetricsFromPayload({
		modelRequests: [null, {}, { ...observation, status: 'running' }, observation]
	})
	expect(restored).toHaveLength(1)
	expect(restored[0]).not.toHaveProperty('prompt')
	expect(restored[0]).not.toHaveProperty('error')
	expect(restored[0]).toMatchObject({
		inputTokens: 32,
		firstTextMs: 8,
		startedAt: observation.startedAt
	})
	for (const startedAt of [-1, NaN, Infinity, 'now'])
		expect(
			modelMetricsFromPayload({ modelRequests: [{ ...observation, startedAt }] })[0]
		).not.toHaveProperty('startedAt')
	expect(restored[0]?.replayed).toBe(true)
	expect(
		modelMetricsFromPayload({
			modelRequests: [{ ...observation, replayed: 'true' }]
		})[0]
	).not.toHaveProperty('replayed')
	expect(
		modelMetricsFromPayload({
			modelRequests: [{ ...observation, firstTextMs: 13 }]
		})[0]
	).not.toHaveProperty('firstTextMs')
	expect(
		modelMetricsFromPayload({
			modelRequests: [{ ...observation, durationMs: -1 }]
		})
	).toEqual([])
	expect(
		modelMetricsFromPayload({
			modelRequests: Array.from({ length: 80 }, (_, i) => ({
				...observation,
				id: String(i)
			}))
		})
	).toHaveLength(MAX_MODEL_METRICS)
})

test('tool and model diagnostics together remain below the contribution payload limit', () => {
	const payload = turnPayload({
		id: 'synthetic-response',
		role: 'assistant',
		content: '',
		modelRequestCount: 100,
		modelRequests: Array.from({ length: 100 }, (_, i) => ({
			id: `synthetic-model-${i}`,
			phase: 'answer',
			status: 'completed',
			durationMs: 1.25,
			firstTextMs: 0.75,
			inputTokens: 50000,
			outputTokens: 1500
		})),
		calls: Array.from({ length: 128 }, (_, i) => ({
			id: `synthetic-call-${i}`,
			name: 'workspace_read',
			status: 'completed',
			arguments: '界'.repeat(1500),
			result: '界'.repeat(30000)
		}))
	})
	expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(64 * 1024)
	expect(modelMetricsFromPayload(payload)).toHaveLength(MAX_MODEL_METRICS)
	expect(payload.modelRequestCount).toBe(100)
})
