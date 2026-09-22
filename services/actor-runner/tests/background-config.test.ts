import { describe, expect, it } from 'vitest'
import { actorRunnerConfigSchema } from '../src/config.js'
import { deployedChatEngineDigest } from '../src/engine-fingerprint.js'

const base = {
	ACTOR_RUNNER_SERVICE_BEARER_TOKEN: 'a'.repeat(32),
	TENANT_GRANT_PUBLIC_KEY: 'test-key',
	CUSTOMER_DATABASE_HOST: 'localhost',
	ACTOR_API_DB_CREDENTIAL_ROOT: 'b'.repeat(32),
	ACTOR_WORKER_DB_CREDENTIAL_ROOT: 'c'.repeat(32),
	ARTIFACT_STORE_BASE_URL: 'http://localhost:3001',
	ARTIFACT_STORE_BEARER_TOKEN: 'd'.repeat(32),
	LLM_GATEWAY_BASE_URL: 'http://localhost:3002',
	LLM_GATEWAY_BEARER_TOKEN: 'e'.repeat(32)
}
const background = {
	WORK_CONTROL_URL: 'http://localhost:3002',
	WORK_GRANT_EXCHANGE_BEARER_TOKEN: 'f'.repeat(32),
	INTENT_SERVICE_BASE_URL: 'http://localhost:3003',
	INTENT_SERVICE_BEARER_TOKEN: 'g'.repeat(32),
	CHAT_MODEL_ID: 'test-qwen'
}

describe('background Chat startup boundary', () => {
	it('keeps the existing runner usable with background execution disabled', () => {
		expect(actorRunnerConfigSchema.parse(base).WORK_CONTROL_URL).toBeUndefined()
	})
	it('requires every destination, credential and model together', () => {
		expect(actorRunnerConfigSchema.parse({ ...base, ...background }).CHAT_MODEL_ID).toBe(
			'test-qwen'
		)
		for (const key of Object.keys(background)) {
			const partial: Record<string, unknown> = { ...background }
			delete partial[key]
			expect(actorRunnerConfigSchema.safeParse({ ...base, ...partial }).success).toBe(false)
			expect(
				actorRunnerConfigSchema.safeParse({
					...base,
					[key]: background[key as keyof typeof background]
				}).success
			).toBe(false)
		}
	})
	it('refuses to pretend a watched source entrypoint identifies a replayable engine', async () => {
		await expect(deployedChatEngineDigest('test-qwen')).rejects.toThrow('Build Actor Runner')
	})
})
