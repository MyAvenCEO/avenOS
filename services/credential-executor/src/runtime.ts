import { ArtifactRunStore, ArtifactStoreClient } from '@avenos/artifact-store'
import type { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { credentialUseVerifier } from '@avenos/credential-storage/authority'
import { CredentialStoreError } from '@avenos/credential-storage/contracts'
import type { loadCredentialUnsealer } from '@avenos/credential-storage/keys'
import { CredentialUseStore } from '@avenos/credential-storage/postgres'
import { ConnectionArtifacts } from './artifacts'
import type { ConnectionExecutorHost } from './handler'

/** Fixed deployment routes and a protocol-specific SQL role. No Actor-facing
 * callback can select a database, endpoint, key ring or publication identity. */
export function connectionExecutorHost(
	config: {
		protocol: 'http' | 'imap'
		policyUrl: string
		policyToken: string
		issuer: string
		publicKey: CryptoKey
		artifactUrl: string
		artifactToken: string
		publisher: { issuer: string; subject: string }
		allowedOrigins: readonly string[]
	},
	pools: Pick<TenantPoolProvider, 'forGrant'>,
	unsealer: Awaited<ReturnType<typeof loadCredentialUnsealer>>,
	fetcher: typeof fetch = fetch
): ConnectionExecutorHost {
	const verify = credentialUseVerifier(config.issuer, config.publicKey, config.protocol)
	return {
		verify,
		async forGrant(grant, identityToken, authorization) {
			const initial = await verify(authorization)
			const authorize = async (use: typeof initial) => {
				// The signature must still validate, not merely the payload retained by a
				// protocol client. The API independently rebuilds current authority.
				const signed = await verify(authorization)
				if (JSON.stringify(signed) !== JSON.stringify(use))
					throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
				const response = await fetcher(
					new URL('/internal/v1/connections/verify', config.policyUrl),
					{
						method: 'POST',
						redirect: 'manual',
						signal: AbortSignal.timeout(5000),
						headers: {
							authorization: `Bearer ${config.policyToken}`,
							'x-aven-identity-token': identityToken,
							'content-type': 'application/json'
						},
						body: JSON.stringify({ protocol: config.protocol, authorization })
					}
				)
				await response.body?.cancel()
				if (response.status !== 204) throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
			}
			await authorize(initial)
			const store = new CredentialUseStore(
				await pools.forGrant(grant),
				{
					environmentId: grant.environmentId,
					subjectId: grant.sub,
					generation: grant.routingGeneration
				},
				config.protocol
			)
			const artifacts = new ConnectionArtifacts(
				new ArtifactRunStore(
					new ArtifactStoreClient({
						baseUrl: config.artifactUrl,
						bearerToken: () => config.artifactToken,
						requestHeaders: () => ({
							'x-aven-artifact-database': grant.databaseName,
							'x-aven-environment': grant.environmentId,
							'x-aven-routing-generation': String(grant.routingGeneration)
						}),
						fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(15000) })
					}),
					grant.environmentId
				),
				config.publisher,
				authorize
			)
			return {
				store,
				artifacts,
				unsealer,
				authorize,
				allowedOrigins: config.allowedOrigins,
				request: (use) => artifacts.request(use),
				selection: (use, source) => artifacts.selection(use, source)
			}
		}
	}
}
