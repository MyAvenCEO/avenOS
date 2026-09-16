import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
	databaseNameForEnvironment,
	importTenantGrantPrivateKey,
	importTenantGrantPublicKey,
	signTenantGrant
} from '@avenos/aven-customer-contracts'
import { describe, expect, test, vi } from 'vitest'
import { createIntentHandler } from '../src/handler.js'
import type { ContributionInput, IntentDetail } from '../src/store.js'

const serviceToken = 's'.repeat(32)
const subject = '3f7b0f1e-7850-4902-a7b0-093f8604a0dd'
const intentId = 'ce31a00e-5f10-4707-ac07-e3b0cbd43ba4'
const contributionId = '75d128b6-74e3-4095-9d63-147324c88dd9'
const environmentId = randomUUID()
const pair = generateKeyPairSync('ed25519')
const privateKey = await importTenantGrantPrivateKey(
	pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
)
const publicKey = await importTenantGrantPublicKey(
	pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
)
const claims = {
	subject,
	value: {
		sub: subject,
		sid: 'session-1',
		email: 'u@example.test',
		email_verified: true as const,
		role: 'user' as const,
		amr: ['passkey'] as Array<'passkey' | 'bootstrap'>,
		scope: 'openid services:access',
		iss: 'https://aven.id',
		aud: 'aven-services',
		exp: 2_000_000_000
	}
}

const detail: IntentDetail = {
	id: intentId,
	title: 'Conversation',
	intentType: 'intent',
	sourceLabel: 'Conversation',
	deadline: null,
	routingSummary: 'Intent: Conversation',
	state: 'working',
	version: 1,
	sourceArtifactId: null,
	createdAt: '2026-08-29T00:00:00.000Z',
	updatedAt: '2026-08-29T00:00:00.000Z',
	contributions: [],
	artifacts: [],
	fileSkill: null
}

function store() {
	return {
		ready: vi.fn(async () => {}),
		page: vi.fn(async () => ({
			intents: [detail],
			hasMore: false,
			nextCursor: null,
			matchMode: 'recent'
		})),
		messages: vi.fn(async () => ({
			messages: [],
			hasMore: false,
			nextCursor: null,
			matchMode: 'recent',
			notice: ''
		})),
		message: vi.fn(async () => ({
			id: contributionId,
			intentId,
			createdAt: '2026-06-11T10:00:00Z',
			role: 'user',
			content: 'hello',
			offset: 0,
			totalChars: 5,
			nextOffset: null
		})),
		detail: vi.fn(async () => detail),
		create: vi.fn(async () => detail),
		append: vi.fn(async (_subject: string, _intent: string, input: ContributionInput) => ({
			...input,
			sequence: 2,
			createdAt: '2026-08-29T00:00:01.000Z'
		})),
		update: vi.fn(async () => detail),
		archiveOrRestore: vi.fn(async () => detail),
		tombstone: vi.fn(async () => {}),
		merge: vi.fn(async () => detail)
	}
}

async function headers(action = 'intents:read', overrides: Record<string, string> = {}) {
	const tenantGrant = await signTenantGrant(
		{
			iss: 'https://api.aven.ceo',
			aud: 'ceo.aven:component:data:intents@1',
			sub: subject,
			sid: 'session-1',
			role: 'user',
			membershipRole: 'owner',
			environmentId,
			databaseName: databaseNameForEnvironment(environmentId),
			routingGeneration: 1,
			componentRef: 'ceo.aven:component:data:intents@1',
			actions: [action]
		},
		privateKey
	)
	return {
		authorization: `Bearer ${serviceToken}`,
		'x-aven-identity-token': 'signed-user-jwt',
		'x-aven-tenant-grant': tenantGrant,
		'x-aven-subject': subject,
		'x-aven-role': 'user',
		'x-aven-session': 'session-1',
		...overrides
	}
}

function handler(repository = store()) {
	return {
		repository,
		fetch: createIntentHandler(
			{
				INTENT_SERVICE_BEARER_TOKEN: serviceToken,
				TENANT_GRANT_ISSUER: 'https://api.aven.ceo'
			},
			{ verify: vi.fn(async () => claims.value) },
			publicKey,
			{ forGrant: vi.fn(async () => repository) }
		)
	}
}

describe('Intent Service split boundary', () => {
	test('requires the private facade credential before touching storage', async () => {
		const { fetch, repository } = handler()
		const response = await fetch(new Request('http://intent/api/intents/search'))
		expect(response.status).toBe(401)
		expect(repository.page).not.toHaveBeenCalled()
	})

	test('rejects a forged facade identity projection', async () => {
		const { fetch, repository } = handler()
		const response = await fetch(
			new Request('http://intent/api/intents', {
				headers: await headers('intents:read', {
					'x-aven-subject': 'a0000000-0000-4000-8000-000000000000'
				})
			})
		)
		expect(response.status).toBe(401)
		expect(repository.page).not.toHaveBeenCalled()
	})

	test('scopes search and create operations to the independently verified subject', async () => {
		const { fetch, repository } = handler()
		const listed = await fetch(
			new Request('http://intent/api/intents/search', { headers: await headers() })
		)
		expect(listed.status).toBe(200)
		expect(repository.page).toHaveBeenCalledWith(subject, {})

		const created = await fetch(
			new Request('http://intent/api/intents', {
				method: 'POST',
				headers: { ...(await headers('intents:write')), 'content-type': 'application/json' },
				body: JSON.stringify({ id: intentId, title: 'Conversation' })
			})
		)
		expect(created.status).toBe(201)
		expect(repository.create).toHaveBeenCalledWith(
			subject,
			expect.objectContaining({
				id: intentId,
				intentType: 'intent',
				sourceLabel: 'Conversation'
			})
		)
	})

	test('preserves bounded anonymous speaker metadata on a contribution', async () => {
		const { fetch, repository } = handler()
		const anonymousSpeaker = {
			session_id: 'voice-session-1',
			speaker_id: 'speaker-2',
			confidence: 0.91
		}
		const response = await fetch(
			new Request(`http://intent/api/intents/${intentId}`, {
				method: 'POST',
				headers: { ...(await headers('intents:write')), 'content-type': 'application/json' },
				body: JSON.stringify({
					id: contributionId,
					contributorKind: 'human',
					kind: 'message',
					text: 'Bitte unterbrich die Erzählung.',
					payload: { anonymousSpeaker }
				})
			})
		)
		expect(response.status).toBe(201)
		expect(repository.append).toHaveBeenCalledWith(
			subject,
			intentId,
			expect.objectContaining({ payload: { anonymousSpeaker } })
		)
	})

	test('rejects contribution metadata larger than 64 KiB', async () => {
		const { fetch, repository } = handler()
		const response = await fetch(
			new Request(`http://intent/api/intents/${intentId}`, {
				method: 'POST',
				headers: { ...(await headers('intents:write')), 'content-type': 'application/json' },
				body: JSON.stringify({
					id: contributionId,
					contributorKind: 'human',
					kind: 'message',
					text: null,
					payload: { value: 'x'.repeat(70 * 1024) }
				})
			})
		)
		expect(response.status).toBe(400)
		expect(repository.append).not.toHaveBeenCalled()
	})
})

test('retrieval routes authorize the subject and validate bounded inputs before storage', async () => {
	const { fetch, repository } = handler()
	for (const path of [
		'/api/intents/search?query=buro&limit=2',
		'/api/intents/messages?query=old'
	]) {
		const response = await fetch(new Request(`http://intent${path}`, { headers: await headers() }))
		expect(response.status).toBe(200)
	}
	expect(repository.page).toHaveBeenCalledWith(subject, { query: 'buro', limit: 2 })
	expect(repository.messages).toHaveBeenCalledWith(subject, { query: 'old' })
	const full = await fetch(
		new Request(`http://intent/api/intents/messages/${contributionId}?offset=2`, {
			headers: await headers()
		})
	)
	expect(full.status).toBe(200)
	expect(repository.message).toHaveBeenCalledWith(subject, contributionId, 2)
	for (const path of [
		'/api/intents/search?limit=100000',
		'/api/intents/messages?intent=bad',
		'/api/intents/search?unknown=true',
		`/api/intents/messages/${contributionId}?offset=-1`
	])
		expect(
			(await fetch(new Request(`http://intent${path}`, { headers: await headers() }))).status
		).toBe(400)
	expect((await fetch(new Request('http://intent/api/intents/search'))).status).toBe(401)
})

test('intent enumeration requires the bounded search route', async () => {
	const { fetch, repository } = handler()
	const response = await fetch(
		new Request('http://intent/api/intents', { headers: await headers() })
	)
	expect(response.status).toBe(404)
	expect(repository.page).not.toHaveBeenCalled()
})
