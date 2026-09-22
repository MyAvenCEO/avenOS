import {
	type TenantGrantClaims,
	type TenantGrantKey,
	verifyWorkGrant,
	type WorkGrantClaims,
	workAllows
} from '@avenos/aven-customer-contracts'
import { CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import { admissionDigest, type InputAdmission } from '@avenos/intents/admission'

export interface AdmissionWorkAuthority {
	token: string
	claims: WorkGrantClaims
}

/** No identity JWT is retained. The certificate authorizes only this exact accepted input. */
export async function admitWorkAuthority(
	token: string,
	key: TenantGrantKey,
	issuer: string,
	tenant: TenantGrantClaims,
	input: InputAdmission
): Promise<AdmissionWorkAuthority> {
	try {
		const claims = await verifyWorkGrant(token, key, issuer)
		if (
			claims.sub !== tenant.sub ||
			claims.sid !== tenant.sid ||
			claims.role !== tenant.role ||
			claims.membershipRole !== tenant.membershipRole ||
			claims.environmentId !== tenant.environmentId ||
			claims.databaseName !== tenant.databaseName ||
			claims.routingGeneration !== tenant.routingGeneration ||
			claims.inputId !== input.inputId ||
			claims.inputRevision !== input.revision ||
			claims.materialDigest !== (await admissionDigest(input)) ||
			!workAllows(claims, 'ceo.aven:component:data:intents@1', ['intents:read', 'intents:write']) ||
			!workAllows(claims, 'os.aven:component:actors:run-repository@1', ['actor-runs:write'])
		)
			throw new Error('Work authority does not match the admission.')
		return { token, claims }
	} catch {
		throw new CustomerAdmissionError()
	}
}
