import { CredentialStoreError, type CredentialUse } from '@avenos/credential-storage/contracts'
import type { CredentialUseStore } from '@avenos/credential-storage/postgres'

/** Protected host only. The body includes both protocol shutdown and publication.
 * A duplicate handler never owns the first claim and cannot release its fence.
 * Lost SQL acknowledgement deliberately leaves a durable fence for reconciliation.
 * Nothing here grants permission to retry the network request. */
export async function withCredentialExecution<T>(
	store: CredentialUseStore,
	use: CredentialUse,
	body: (onClaim: (claimed: CredentialUse) => void) => Promise<T>
): Promise<T> {
	let owned = false
	try {
		return await body((claimed) => {
			if (owned || claimed.authorizationId !== use.authorizationId)
				throw new CredentialStoreError('CREDENTIAL_USE_CONFLICT')
			owned = true
		})
	} finally {
		if (owned) await store.settle(use.authorizationId)
	}
}
