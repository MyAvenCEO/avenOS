import type { ZodError } from 'zod'

/** Schema diagnostics only: never serialize the rejected input or complete error. */
export function commandValidationFailure(error: ZodError) {
	const issues = error.issues.slice(0, 4).map((issue) => ({
		field: issue.path.map(String).join('.').slice(0, 160),
		message: issue.message.slice(0, 320)
	}))
	return {
		code: 'COMMAND_INVALID',
		message: `Invalid command: ${issues.map((issue) => `${issue.field || 'request'}: ${issue.message}`).join('; ')}`,
		issues
	}
}
