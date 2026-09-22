import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import {
	admitCustomerRequest,
	admitWorkRequest,
	CustomerAdmissionError
} from '@avenos/aven-customer-runtime'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import {
	PRODUCTIVITY_COMPONENT,
	type TaskCause,
	TaskConflict,
	TaskNotFound,
	type TaskRepository,
	taskCauseSchema,
	taskCommandSchema,
	taskListSchema
} from '@avenos/productivity/tasks'
import { z } from 'zod'
import { IntentNotFoundError, type IntentStore } from './store.js'

const commandSchema = z.object({ command: taskCommandSchema, cause: taskCauseSchema }).strict()
const json = (status: number, value: unknown) =>
	Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

export function createTaskIntentVerifier(
	config: { serviceToken: string; issuer: string; key: TenantGrantKey },
	verifier: Pick<IdentityVerifier, 'verify'>,
	stores: { forGrant(grant: TenantGrantClaims): Promise<IntentStore> }
) {
	return async (
		request: Request,
		cause: TaskCause,
		tenant: TenantGrantClaims,
		destination?: string | null
	) => {
		if (!cause.intentId && !destination) return
		const headers = new Headers(request.headers)
		headers.set('x-aven-tenant-grant', headers.get('x-aven-intent-grant') ?? '')
		const boundary = tenant.execution ? admitWorkRequest : admitCustomerRequest
		const authority = await boundary(new Request(request.url, { headers }), {
			serviceToken: config.serviceToken,
			identityVerifier: verifier,
			tenantGrantPublicKey: config.key,
			tenantGrantIssuer: config.issuer,
			componentRef: 'ceo.aven:component:data:intents@1',
			requiredAction: 'intents:read'
		})
		if (
			authority.tenant.sub !== tenant.sub ||
			authority.tenant.environmentId !== tenant.environmentId ||
			authority.tenant.databaseName !== tenant.databaseName ||
			authority.tenant.routingGeneration !== tenant.routingGeneration ||
			JSON.stringify(authority.tenant.execution) !== JSON.stringify(tenant.execution)
		)
			throw new CustomerAdmissionError()
		const store = await stores.forGrant(authority.tenant)
		try {
			if (cause.intentId)
				await store.verifyTaskCause(
					authority.tenant.sub,
					cause.intentId,
					cause.contributionId,
					tenant.execution?.turnId
				)
			// A destination is not the cause of this command. Check that it is an
			// available Intent of the same owner without rebinding the active turn
			// or granting the productivity role access to Intent tables.
			if (destination) await store.verifyTaskCause(authority.tenant.sub, destination, null)
		} catch (error) {
			if (error instanceof IntentNotFoundError) throw new TaskNotFound(error.message)
			throw error
		}
	}
}

/** Shares a process with Intents, never its database role or unsigned authority. */
export function createProductivityHandler(
	config: { serviceToken: string; issuer: string; key: TenantGrantKey },
	verifier: Pick<IdentityVerifier, 'verify'>,
	repositories: { forGrant(grant: TenantGrantClaims): Promise<TaskRepository> },
	verifyIntent: (
		request: Request,
		cause: TaskCause,
		tenant: TenantGrantClaims,
		destination?: string | null
	) => Promise<void>,
	log: (error: unknown) => void = () => {}
) {
	return async (request: Request) => {
		try {
			const url = new URL(request.url),
				path = url.pathname
			const read = request.method === 'GET'
			const boundary = request.headers.has('x-aven-work-grant')
				? admitWorkRequest
				: admitCustomerRequest
			const admitted = await boundary(request, {
				serviceToken: config.serviceToken,
				tenantGrantIssuer: config.issuer,
				tenantGrantPublicKey: config.key,
				identityVerifier: verifier,
				componentRef: PRODUCTIVITY_COMPONENT,
				requiredAction: read ? 'productivity:read' : 'productivity:write'
			})
			const repository = await repositories.forGrant(admitted.tenant)
			if (read && path === '/api/productivity/tasks') {
				for (const key of url.searchParams.keys())
					if (url.searchParams.getAll(key).length > 1)
						return json(400, { code: 'TASK_INPUT_INVALID', message: 'Use each filter once.' })
				const raw = Object.fromEntries(url.searchParams)
				const query = taskListSchema.parse({
					...raw,
					...(raw.limit && { limit: Number(raw.limit) }),
					...(raw.archived !== undefined && {
						archived:
							raw.archived === 'true' ? true : raw.archived === 'false' ? false : raw.archived
					})
				})
				return json(200, await repository.list(admitted.tenant.sub, query))
			}
			const receipt = path.match(/^\/api\/productivity\/commands\/([0-9a-f-]{36})$/i)
			if (read && receipt) {
				const found = await repository.receipt(admitted.tenant.sub, z.uuid().parse(receipt[1]))
				return found
					? json(200, found)
					: json(404, {
							code: 'TASK_RECEIPT_NOT_FOUND',
							message: 'No saved outcome was found for this operation.'
						})
			}
			if (request.method === 'POST' && path === '/api/productivity/commands') {
				const { command, cause } = commandSchema.parse(await readBoundedJson(request, 128 * 1024))
				if (admitted.tenant.execution && (!cause.intentId || !cause.contributionId))
					throw new CustomerAdmissionError()
				const destination = command.operation === 'update' ? command.patch.intentId : undefined
				if (cause.intentId || destination)
					await verifyIntent(request, cause, admitted.tenant, destination)
				return json(200, await repository.execute(admitted.tenant.sub, command, cause))
			}
			return json(404, {
				code: 'TASK_ROUTE_NOT_FOUND',
				message: 'This task operation does not exist.'
			})
		} catch (error) {
			if (error instanceof CustomerAdmissionError)
				return json(403, { code: 'TASK_ACCESS_DENIED', message: 'Task access was not authorized.' })
			if (error instanceof TaskConflict)
				return json(409, { code: 'TASK_CONFLICT', message: error.message })
			if (error instanceof TaskNotFound)
				return json(404, { code: 'TASK_NOT_FOUND', message: error.message })
			if (error instanceof z.ZodError)
				return json(400, {
					code: 'TASK_INPUT_INVALID',
					message: 'Check the task fields and current revisions.'
				})
			if (error instanceof SyntaxError)
				return json(400, {
					code: 'TASK_INPUT_INVALID',
					message: 'The task request is not valid JSON.'
				})
			if (error instanceof BodyLimitError)
				return json(413, { code: 'TASK_INPUT_TOO_LARGE', message: 'Choose a smaller task batch.' })
			log(error)
			return json(503, {
				code: 'TASKS_UNAVAILABLE',
				message:
					'Tasks are unavailable. Keep the operation ID to check whether this change was saved.'
			})
		}
	}
}
