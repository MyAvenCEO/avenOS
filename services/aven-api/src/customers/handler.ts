import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
	signTenantGrant,
	signWorkGrant,
	type TenantGrantClaims,
	type TenantGrantKey
} from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { readBoundedJson } from '@avenos/http-boundary'
import {
	admissionDigest,
	type InputAdmission,
	inputAdmissionSchema
} from '@avenos/intents/admission'
import { z } from 'zod'
import type { CustomerStore, EntitlementEvent } from './store.js'
import { CustomerAuthorizationError } from './store.js'

const entitlementSchema = z
	.object({
		eventId: z.uuid(),
		eventType: z.enum(['purchase_granted', 'purchase_revoked']),
		subjectId: z.uuid(),
		purchasedName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
		occurredAt: z.iso.datetime()
	})
	.strict()

const json = (status: number, body: unknown) =>
	Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

function authorized(request: Request, secret: string): boolean {
	const actual = Buffer.from(request.headers.get('authorization') ?? '')
	const expected = Buffer.from(`Bearer ${secret}`)
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export class CustomerHandler {
	constructor(
		private readonly entitlementStore: CustomerStore,
		private readonly authorizationStore: CustomerStore,
		private readonly entitlementToken: string,
		private readonly tenantGrantPrivateKey: TenantGrantKey
	) {}

	async internal(request: Request): Promise<Response> {
		if (!authorized(request, this.entitlementToken)) return json(404, { code: 'NOT_FOUND' })
		if (
			request.method !== 'POST' ||
			new URL(request.url).pathname !== '/internal/v1/customer-entitlement-events'
		)
			return json(404, { code: 'NOT_FOUND' })
		const parsed = entitlementSchema.safeParse(
			await readBoundedJson(request, 16384).catch(() => null)
		)
		if (!parsed.success) return json(400, { code: 'ENTITLEMENT_EVENT_INVALID' })
		try {
			const result = await this.entitlementStore.acceptEntitlement(parsed.data as EntitlementEvent)
			return json(result.replay ? 200 : 201, result)
		} catch (error) {
			return this.failure(error) ?? json(500, { code: 'ENTITLEMENT_EVENT_FAILED' })
		}
	}

	async list(claims: IdentityClaims): Promise<Response> {
		return json(200, { environments: await this.authorizationStore.list(claims.sub) })
	}

	async grant(input: {
		claims: IdentityClaims
		environmentId: string
		componentRef: string
		actions: string[]
	}): Promise<{
		claims: Omit<TenantGrantClaims, 'iat' | 'exp'>
		token: string
		runtimeId: string
	}> {
		const { runtimeId, ...claims } = await this.authorizationStore.authorize(
			input.claims,
			input.environmentId,
			input.componentRef,
			input.actions
		)
		return { claims, runtimeId, token: await signTenantGrant(claims, this.tenantGrantPrivateKey) }
	}

	/** Fixed host policy, not scopes supplied by a model or a caller. */
	async work(input: {
		claims: IdentityClaims
		environmentId: string
		admission: InputAdmission
		expectedGeneration: number
		expectedRuntime: string
	}): Promise<string> {
		const admission = inputAdmissionSchema.parse(input.admission)
		const scopes = [
			{
				componentRef: 'ceo.aven:component:data:intents@1',
				actions: ['intents:read', 'intents:write'],
				required: true
			},
			{
				componentRef: 'os.aven:component:actors:run-repository@1',
				actions: ['actor-runs:read', 'actor-runs:write'],
				required: true
			},
			{
				componentRef: 'ceo.aven:component:data:artifacts@1',
				actions: ['artifacts:read', 'artifacts:write'],
				required: false
			},
			{
				componentRef: 'ceo.aven:component:data:productivity@1',
				actions: ['productivity:read', 'productivity:write'],
				required: false
			}
		]
		const grants = await Promise.all(
			scopes.map(async (scope) => {
				try {
					return await this.authorizationStore.authorize(
						input.claims,
						input.environmentId,
						scope.componentRef,
						scope.actions
					)
				} catch (error) {
					if (
						!scope.required &&
						error instanceof CustomerAuthorizationError &&
						['ENVIRONMENT_NOT_FOUND', 'MEMBERSHIP_ACTION_DENIED', 'COMPONENT_NOT_READY'].includes(
							error.code
						)
					)
						return null
					throw error
				}
			})
		)
		const active = grants.filter((grant) => grant !== null)
		const primary = active[0]!
		if (
			active.some(
				(grant) =>
					grant.routingGeneration !== input.expectedGeneration ||
					grant.runtimeId !== input.expectedRuntime ||
					grant.databaseName !== primary.databaseName ||
					grant.membershipRole !== primary.membershipRole
			)
		)
			throw new CustomerAuthorizationError(
				409,
				'WORKSPACE_CHANGED',
				'The workspace changed. Your message was not sent; retry it.'
			)
		return signWorkGrant(
			{
				iss: primary.iss,
				jti: randomUUID(),
				sub: input.claims.sub,
				sid: input.claims.sid,
				role: input.claims.role,
				membershipRole: primary.membershipRole,
				environmentId: input.environmentId,
				databaseName: primary.databaseName,
				routingGeneration: primary.routingGeneration,
				kind: 'chat-turn',
				inputId: admission.inputId,
				inputRevision: admission.revision,
				materialDigest: await admissionDigest(admission),
				permissions: active.map((grant) => ({
					componentRef: grant.componentRef,
					actions: grant.actions
				}))
			},
			this.tenantGrantPrivateKey
		)
	}

	failure(error: unknown): Response | null {
		if (error instanceof CustomerAuthorizationError)
			return json(error.status, { code: error.code, message: error.message })
		return null
	}
}
