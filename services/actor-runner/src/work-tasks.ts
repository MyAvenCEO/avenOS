import { WorkAuthorizationError, type WorkGrantClient } from '@avenos/aven-customer-runtime'
import { readBoundedBytes } from '@avenos/http-boundary'
import { RemoteTaskRepository, TaskRequestError } from '@avenos/productivity/remote'
import { PRODUCTIVITY_COMPONENT } from '@avenos/productivity/tasks'
import { z } from 'zod'

const problems = z.enum([
	'TASK_RECEIPT_NOT_FOUND',
	'TASK_CONFLICT',
	'TASK_NOT_FOUND',
	'TASK_ACCESS_DENIED',
	'TASK_INPUT_INVALID',
	'TASK_INPUT_TOO_LARGE',
	'TASKS_UNAVAILABLE'
])

/** Fixed service transport for the shared Task repository. Every request uses
 * fresh delegated authority; neither a model-selected URL nor a login is accepted.
 * A missing acknowledgement is left uncertain for the original receipt lookup. */
export function createWorkTaskRepository(host: {
	baseUrl: string
	serviceToken: string
	subjectId: string
	workToken: string
	authority: WorkGrantClient
	signal?: AbortSignal
}) {
	const base = new URL(host.baseUrl)
	z.uuid().parse(host.subjectId)
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.pathname !== '/' ||
		host.serviceToken.length < 32
	)
		throw Error('Invalid task work transport configuration.')
	const grant = async (component: string, actions: string[]) => {
		try {
			return await host.authority.grant(component, actions, host.signal)
		} catch (error) {
			if (error instanceof WorkAuthorizationError)
				throw new TaskRequestError(error.message, error.code, error.status)
			throw error
		}
	}
	return new RemoteTaskRepository(host.subjectId, async (method, path, body) => {
		const write = method === 'POST'
		if (write ? path !== '/commands' : !/^\/tasks\?[^#]*$|^\/commands\/[0-9a-f-]{36}$/.test(path))
			throw Error('This conversation cannot use the requested task route.')
		host.signal?.throwIfAborted()
		const [taskGrant, intentGrant] = await Promise.all([
			grant(PRODUCTIVITY_COMPONENT, [write ? 'productivity:write' : 'productivity:read']),
			write ? grant('ceo.aven:component:data:intents@1', ['intents:read']) : undefined
		])
		const headers = new Headers({
			authorization: `Bearer ${host.serviceToken}`,
			'content-type': 'application/json',
			'x-aven-tenant-grant': taskGrant,
			'x-aven-work-grant': host.workToken
		})
		if (intentGrant) headers.set('x-aven-intent-grant', intentGrant)
		host.signal?.throwIfAborted()
		const response = await fetch(new URL(`/api/productivity${path}`, base), {
			method,
			redirect: 'manual',
			headers,
			...(body !== undefined && { body: JSON.stringify(body) }),
			signal: host.signal
				? AbortSignal.any([host.signal, AbortSignal.timeout(10_000)])
				: AbortSignal.timeout(10_000)
		})
		const value = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				await readBoundedBytes(response, response.ok ? 512 * 1024 : 4096, 10_000)
			)
		)
		if (!response.ok) {
			const code = problems.safeParse(value?.code)
			if (
				response.status === 404 &&
				!write &&
				path.startsWith('/commands/') &&
				code.success &&
				code.data === 'TASK_RECEIPT_NOT_FOUND'
			)
				return null
			throw new TaskRequestError(
				response.status === 409
					? 'The task changed. Read its current revision before editing it.'
					: response.status === 404
						? 'The requested task was not found.'
						: 'The task request could not be confirmed. Check its original outcome before retrying.',
				code.success ? code.data : 'TASKS_UNAVAILABLE',
				response.status >= 300 && response.status < 400 ? 503 : response.status
			)
		}
		return value
	})
}
