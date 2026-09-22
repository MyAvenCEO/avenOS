import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitCustomerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { z } from 'zod'
import type { AdmittedInvocations } from './admitted-invocations'

const selection = z.object({ runId: z.uuid(), invocationId: z.uuid() }).strict()
const json = (status: number, body: unknown) =>
	Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	})

/** Internal policy lookup. A signed session and actor-read tenant grant select the
 * owner/environment, but only a live host registration proves admission. No public
 * facade route should forward caller requests to this path. */
export function createInvocationGuardHandler(
	config: { serviceToken: string; issuer: string; key: TenantGrantKey },
	verifier: Pick<IdentityVerifier, 'verify'>,
	forGrant: (grant: TenantGrantClaims) => Promise<AdmittedInvocations>
) {
	return async (request: Request) => {
		try {
			const url = new URL(request.url)
			if (url.pathname !== '/internal/v1/invocations/read' || request.method !== 'POST')
				return json(404, { code: 'ROUTE_NOT_FOUND' })
			if (
				url.search ||
				['origin', 'cookie', 'x-aven-work-grant'].some((name) => request.headers.has(name))
			)
				throw new CustomerAdmissionError()
			const admitted = await admitCustomerRequest(request, {
				serviceToken: config.serviceToken,
				identityVerifier: verifier,
				tenantGrantIssuer: config.issuer,
				tenantGrantPublicKey: config.key,
				componentRef: 'os.aven:component:actors:run-repository@1',
				requiredAction: 'actor-runs:read'
			})
			if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
				return json(415, { code: 'JSON_REQUIRED' })
			const input = selection.parse(await readBoundedJson(request, 1024))
			const registry = await forGrant(admitted.tenant)
			const record = await registry.read({
				...input,
				environmentId: admitted.tenant.environmentId,
				generation: admitted.tenant.routingGeneration,
				subjectId: admitted.identity.sub,
				sessionId: admitted.identity.sid
			})
			if (Date.now() >= 1000 * Math.min(admitted.identity.exp, admitted.tenant.exp))
				throw new CustomerAdmissionError()
			return json(200, record)
		} catch (error) {
			if (error instanceof BodyLimitError) return json(error.status, { code: error.code })
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json(400, { code: 'INVOCATION_INPUT_INVALID' })
			return json(403, { code: 'INVOCATION_ACCESS_DENIED' })
		}
	}
}
