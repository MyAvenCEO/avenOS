import { timingSafeEqual } from 'node:crypto'
import {
	type TenantGrantClaims,
	type TenantGrantKey,
	verifyTenantGrant,
	verifyWorkerPlacement,
	verifyWorkGrant,
	type WorkerPlacement,
	type WorkGrantClaims,
	workAllows
} from '@avenos/aven-customer-contracts'
import {
	IdentityAuthenticationError,
	type IdentityClaims,
	type IdentityVerifier
} from '@avenos/aven-identity'

export class CustomerAdmissionError extends Error {}

function equalSecret(actual: string, expected: string): boolean {
	const left = Buffer.from(actual)
	const right = Buffer.from(expected)
	return left.length === right.length && timingSafeEqual(left, right)
}

/** Internal queue/lifecycle access, never customer login or tool authority. */
export async function admitWorkerRequest(
	request: Request,
	input: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		runtimeId: string
		componentRef: WorkerPlacement['componentRef']
	}
): Promise<WorkerPlacement> {
	if (
		!equalSecret(request.headers.get('authorization') ?? '', `Bearer ${input.serviceToken}`) ||
		[
			'cookie',
			'origin',
			'x-aven-identity-token',
			'x-aven-tenant-grant',
			'x-aven-work-grant',
			'x-aven-subject',
			'x-aven-role',
			'x-aven-session'
		].some((name) => request.headers.has(name))
	)
		throw new CustomerAdmissionError()
	try {
		return await verifyWorkerPlacement(
			request.headers.get('x-aven-worker-placement') ?? '',
			input.tenantGrantPublicKey,
			{
				issuer: input.tenantGrantIssuer,
				runtimeId: input.runtimeId,
				componentRef: input.componentRef
			}
		)
	} catch {
		throw new CustomerAdmissionError()
	}
}

/** A separate work boundary, never a substitute identity or a public login method.
 * The issuer must check the live turn and executor lease at each exchange. Recipients
 * retain their normal physical-generation checks and domain authorization.
 */
export async function admitWorkRequest(
	request: Request,
	input: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		componentRef: string
		requiredAction: string
	}
): Promise<{ tenant: TenantGrantClaims; work: WorkGrantClaims }> {
	return admitBoundWorkRequest(request, input, 'execution')
}

/** Separate admission phase: cannot authorize model calls, tools or publication. */
export async function admitTurnDispatchRequest(
	request: Request,
	input: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		componentRef: string
		requiredAction: string
	}
): Promise<{ tenant: TenantGrantClaims; work: WorkGrantClaims }> {
	return admitBoundWorkRequest(request, input, 'dispatch')
}

async function admitBoundWorkRequest(
	request: Request,
	input: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		componentRef: string
		requiredAction: string
	},
	phase: 'execution' | 'dispatch'
): Promise<{ tenant: TenantGrantClaims; work: WorkGrantClaims }> {
	const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
	if (
		!equalSecret(bearer, input.serviceToken) ||
		[
			'cookie',
			'origin',
			'x-aven-worker-placement',
			'x-aven-identity-token',
			'x-aven-subject',
			'x-aven-role',
			'x-aven-session'
		].some((name) => request.headers.has(name))
	)
		throw new CustomerAdmissionError()
	try {
		const [tenant, work] = await Promise.all([
			verifyTenantGrant(
				request.headers.get('x-aven-tenant-grant') ?? '',
				input.tenantGrantPublicKey,
				{
					issuer: input.tenantGrantIssuer,
					audience: input.componentRef,
					action: input.requiredAction
				}
			),
			verifyWorkGrant(
				request.headers.get('x-aven-work-grant') ?? '',
				input.tenantGrantPublicKey,
				input.tenantGrantIssuer
			)
		])
		// Execution grants are also lease deadlines: login clock tolerance must not
		// extend a previous worker's authority into its replacement's lease.
		if (
			tenant.exp <= Date.now() / 1000 ||
			work.exp <= Date.now() / 1000 ||
			!tenant[phase] ||
			tenant[phase]!.workId !== work.jti ||
			tenant.sub !== work.sub ||
			tenant.sid !== work.sid ||
			tenant.role !== work.role ||
			tenant.membershipRole !== work.membershipRole ||
			tenant.environmentId !== work.environmentId ||
			tenant.databaseName !== work.databaseName ||
			tenant.routingGeneration !== work.routingGeneration ||
			tenant.exp > work.exp ||
			tenant.iat < work.iat ||
			!workAllows(work, tenant.componentRef, tenant.actions)
		)
			throw new CustomerAdmissionError()
		return { tenant, work }
	} catch {
		throw new CustomerAdmissionError()
	}
}

export async function admitCustomerRequest(
	request: Request,
	input: {
		serviceToken: string
		identityVerifier: Pick<IdentityVerifier, 'verify'>
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		componentRef: string
		requiredAction: string
	}
): Promise<{ identity: IdentityClaims; identityToken: string; tenant: TenantGrantClaims }> {
	const serviceBearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
	if (!equalSecret(serviceBearer, input.serviceToken)) throw new CustomerAdmissionError()
	const identityToken = request.headers.get('x-aven-identity-token') ?? ''
	const tenantToken = request.headers.get('x-aven-tenant-grant') ?? ''
	try {
		const [identity, tenant] = await Promise.all([
			input.identityVerifier.verify(identityToken),
			verifyTenantGrant(tenantToken, input.tenantGrantPublicKey, {
				issuer: input.tenantGrantIssuer,
				audience: input.componentRef,
				action: input.requiredAction
			})
		])
		if (
			tenant.execution ||
			tenant.dispatch ||
			request.headers.has('x-aven-worker-placement') ||
			!identity.scope.split(/\s+/).includes('services:access') ||
			!identity.amr.includes('passkey') ||
			request.headers.get('x-aven-subject') !== identity.sub ||
			request.headers.get('x-aven-role') !== identity.role ||
			request.headers.get('x-aven-session') !== identity.sid ||
			tenant.sub !== identity.sub ||
			tenant.sid !== identity.sid ||
			tenant.role !== identity.role
		)
			throw new Error('identity and tenant grant binding mismatch')
		return { identity, identityToken, tenant }
	} catch (error) {
		if (error instanceof IdentityAuthenticationError) throw new CustomerAdmissionError()
		throw new CustomerAdmissionError()
	}
}
