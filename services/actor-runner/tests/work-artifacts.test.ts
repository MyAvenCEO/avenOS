import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
	databaseNameForEnvironment,
	importTenantGrantPrivateKey,
	importTenantGrantPublicKey,
	signTenantGrant
} from '@avenos/aven-customer-contracts'
import type { WorkGrantClient } from '@avenos/aven-customer-runtime'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ArtifactWorkOutcomeUncertain, createWorkArtifactPublisher } from '../src/work-artifacts.js'

describe('work artifact write outcomes', () => {
	afterEach(() => vi.unstubAllGlobals())

	async function publisher(response: () => Response) {
		const pair = generateKeyPairSync('ed25519')
		const privateKey = await importTenantGrantPrivateKey(
			pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
		)
		const publicKey = await importTenantGrantPublicKey(
			pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
		)
		const environmentId = randomUUID()
		const subjectId = randomUUID()
		const issuer = 'https://work-artifact-proof.example.test'
		const token = await signTenantGrant(
			{
				iss: issuer,
				aud: 'ceo.aven:component:data:artifacts@1',
				sub: subjectId,
				sid: 'synthetic-session',
				role: 'user',
				membershipRole: 'owner',
				environmentId,
				databaseName: databaseNameForEnvironment(environmentId),
				routingGeneration: 1,
				componentRef: 'ceo.aven:component:data:artifacts@1',
				actions: ['artifacts:write'],
				execution: {
					workId: randomUUID(),
					turnId: randomUUID(),
					runId: randomUUID(),
					leaseOwnerId: randomUUID()
				}
			},
			privateKey
		)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		)
		return {
			client: createWorkArtifactPublisher({
				baseUrl: 'https://artifact-store.example.test',
				serviceToken: 's'.repeat(32),
				environmentId,
				generation: 1,
				issuer,
				publicKey,
				subjectId,
				authority: { grant: async () => token } as unknown as WorkGrantClient
			}),
			environmentId
		}
	}

	test('reports catalog reconciliation as a definite rejected write', async () => {
		const { client, environmentId } = await publisher(() =>
			Response.json(
				{
					code: 'STORE_RECONCILIATION_REQUIRED',
					detail: 'synthetic catalog mismatch'
				},
				{ status: 503 }
			)
		)
		await expect(
			client.upload(
				environmentId,
				randomUUID(),
				{ sha256: 'a'.repeat(64), length: 1, declaredMediaType: 'text/plain' },
				new Uint8Array([1])
			)
		).rejects.toMatchObject({ status: 503, code: 'STORE_RECONCILIATION_REQUIRED' })
	})

	test('keeps an unstructured server failure uncertain after write dispatch', async () => {
		const { client, environmentId } = await publisher(
			() => new Response('unstructured failure', { status: 503 })
		)
		await expect(
			client.upload(
				environmentId,
				randomUUID(),
				{ sha256: 'a'.repeat(64), length: 1, declaredMediaType: 'text/plain' },
				new Uint8Array([1])
			)
		).rejects.toBeInstanceOf(ArtifactWorkOutcomeUncertain)
	})
})
