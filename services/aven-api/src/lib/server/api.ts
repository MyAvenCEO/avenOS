import { isRedirect, json, type RequestEvent, type RequestHandler } from '@sveltejs/kit'
import { ZodError } from 'zod'
import type { SessionUser } from '$lib/types.js'
import { AppError } from './errors.js'
import { isAdminRole } from './identity.js'
import { type Runtime, runtime } from './runtime.js'

// Wraps an API handler so AppError and ZodError map to structured JSON error
// responses, mirroring the express error handler in the original system.
export function api(
	handler: (
		event: RequestEvent,
		rt: Runtime
	) => Promise<{ body: unknown; status?: number } | Response>
): RequestHandler {
	return async (event) => {
		const rt = await runtime()
		try {
			const result = await handler(event, rt)
			if (result instanceof Response) return result
			return json(result.body, { status: result.status ?? 200 })
		} catch (error) {
			// A handler that navigates (redirect(...)) throws a control-flow signal,
			// not a failure — let SvelteKit have it.
			if (isRedirect(error)) throw error
			if (error instanceof AppError)
				return json(
					{
						code: error.code,
						message: error.message,
						...(error.details === undefined ? {} : { details: error.details })
					},
					{ status: error.status }
				)
			if (error instanceof ZodError)
				return json(
					{ code: 'VALIDATION_ERROR', message: 'The request was invalid.', details: error.issues },
					{ status: 400 }
				)
			rt.logger.error({ err: error }, 'unhandled api error')
			return json(
				{ code: 'INTERNAL_ERROR', message: 'The service could not complete the request.' },
				{ status: 500 }
			)
		}
	}
}

export async function requireUser(event: RequestEvent): Promise<SessionUser> {
	const rt = await runtime()
	const session = await rt.auth.api.getSession({ headers: event.request.headers })
	if (!session) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in is required.')
	if (!session.user.emailVerified)
		throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email before continuing.')
	return {
		id: session.user.id,
		name: session.user.name,
		email: session.user.email,
		emailVerified: session.user.emailVerified,
		role: isAdminRole(session.user.role) ? 'admin' : 'user'
	}
}

export async function readJson(event: RequestEvent): Promise<unknown> {
	try {
		return await event.request.json()
	} catch {
		throw new AppError(400, 'VALIDATION_ERROR', 'The request body must be JSON.')
	}
}
