import type {
	ActorInvocationHost,
	AdmittedActorInvocation,
	PlanRunExecutionContext,
	PlanRunStartRequest
} from '@avenos/actors'
import { clientRunIdentity } from '@avenos/artifact-store'
import type pg from 'pg'
import { z } from 'zod'

const scopeSchema = z
	.object({
		environmentId: z.uuid(),
		generation: z.number().int().positive()
	})
	.strict()
export interface AdmittedExecutionRecord {
	environmentId: string
	generation: number
	subjectId: string
	sessionId: string
	runId: string
	leaseOwnerId: string
	invocationId: string
	stepId: string
	definitionRef: string
	capabilityId: string
	parameters: Record<string, unknown>
	inputs: Array<{
		slot: string
		artifactId: string
		artifactDigest: string
		type: string
		version: number
	}>
	expiresAt: string
}

/** Live host evidence, not caller-supplied execution claims. An entry exists only
 * inside the shared runtime's admitted dispatch boundary. Restarts forget entries
 * and therefore deny old use; a resumed run must enter admission again. No identity
 * token, credential, input contents or Actor output is stored here. */
export class AdmittedInvocations {
	private readonly scope: z.infer<typeof scopeSchema>
	private readonly active = new Map<
		string,
		{
			record: Omit<AdmittedExecutionRecord, 'expiresAt'>
			idempotencyKey: string
			context: Pick<PlanRunExecutionContext, 'lease' | 'signal'>
		}
	>()
	constructor(
		scope: z.infer<typeof scopeSchema>,
		private readonly pool: Pick<pg.Pool, 'query'>
	) {
		this.scope = scopeSchema.parse(scope)
	}

	host(
		request: PlanRunStartRequest,
		context: PlanRunExecutionContext | undefined,
		beforeDispatch?: (record: AdmittedExecutionRecord) => Promise<void>
	): ActorInvocationHost {
		return {
			invoke: async (invocation, dispatch) => {
				if (!context?.lease || !context.session || context.signal?.aborted)
					throw Error('INVOCATION_AUTHORITY_UNAVAILABLE')
				const { lease, session } = context
				if (
					invocation.payload.runId !== request.idempotencyKey ||
					invocation.principal.kind !== 'user' ||
					invocation.principal.subjectId !== request.security.principal.subjectId ||
					invocation.access.tenantId !== this.scope.environmentId ||
					request.security.access.tenantId !== this.scope.environmentId ||
					this.active.size >= 128
				)
					throw Error('INVOCATION_AUTHORITY_UNAVAILABLE')
				await lease.assertActive()
				const invocationId = await admittedInvocationId(lease.runId, invocation.payload.stepId)
				if (this.active.has(invocationId)) throw Error('INVOCATION_ALREADY_ACTIVE')
				const entry = {
					idempotencyKey: request.idempotencyKey,
					context: { lease, signal: context.signal },
					record: {
						...this.scope,
						subjectId: invocation.principal.subjectId,
						sessionId: session.sessionId,
						runId: z.uuid().parse(lease.runId),
						leaseOwnerId: z.uuid().parse(lease.ownerId),
						invocationId,
						stepId: invocation.payload.stepId,
						definitionRef: invocation.definitionRef,
						capabilityId: invocation.payload.capabilityId,
						parameters: structuredClone(invocation.payload.parameters),
						inputs: inputIdentities(invocation)
					}
				}
				this.active.set(invocationId, entry)
				try {
					const current = await this.read({
						...this.scope,
						subjectId: entry.record.subjectId,
						sessionId: session.sessionId,
						runId: lease.runId,
						invocationId
					})
					await beforeDispatch?.(current)
					context.signal?.throwIfAborted()
					await lease.assertActive()
					return await dispatch()
				} finally {
					if (this.active.get(invocationId) === entry) this.active.delete(invocationId)
				}
			}
		}
	}

	async read(scope: {
		environmentId: string
		generation: number
		subjectId: string
		sessionId: string
		runId: string
		invocationId: string
	}): Promise<AdmittedExecutionRecord> {
		const entry = this.active.get(scope.invocationId)
		if (
			!entry ||
			Object.entries(scope).some(
				([key, value]) => entry.record[key as keyof typeof entry.record] !== value
			)
		)
			throw Error('INVOCATION_NOT_ACTIVE')
		entry.context.signal?.throwIfAborted()
		const found = await this.pool.query(
			`SELECT r.record->'lease'->>'expiresAt' AS expires_at
			 FROM aven_actor_runs.runs r, aven_platform.environment_identity e
			 WHERE e.singleton AND e.environment_id=$1 AND e.routing_generation=$2
			 AND e.execution_enabled AND r.id=$3 AND r.subject_id=$4
			 AND r.idempotency_key=$5 AND r.state='running'
			 AND r.record->'lease'->>'ownerId'=$6
			 AND (r.record->'lease'->>'expiresAt')::timestamptz > clock_timestamp()`,
			[
				scope.environmentId,
				scope.generation,
				scope.runId,
				scope.subjectId,
				entry.idempotencyKey,
				entry.record.leaseOwnerId
			]
		)
		entry.context.signal?.throwIfAborted()
		if (!found.rowCount || this.active.get(scope.invocationId) !== entry)
			throw Error('INVOCATION_NOT_ACTIVE')
		const expiresAt = new Date(found.rows[0].expires_at).toISOString()
		return structuredClone({ ...entry.record, expiresAt })
	}
}

export async function admittedInvocationId(runId: string, stepId: string) {
	z.uuid().parse(runId)
	if (
		!stepId ||
		stepId.length > 1024 ||
		[...stepId].some((character) => {
			const code = character.charCodeAt(0)
			return code < 32 || code === 127
		})
	)
		throw Error('INVOCATION_ID_INVALID')
	return clientRunIdentity(`admitted-invocation:${runId}:${stepId}`)
}

function inputIdentities(invocation: AdmittedActorInvocation): AdmittedExecutionRecord['inputs'] {
	return Object.entries(invocation.payload.inputMembers ?? {}).flatMap(([slot, members]) =>
		members.map((input) => ({
			slot,
			artifactId: input.artifactId,
			artifactDigest: input.contentDigest,
			type: input.typeKey,
			version: input.schemaVersion
		}))
	)
}
