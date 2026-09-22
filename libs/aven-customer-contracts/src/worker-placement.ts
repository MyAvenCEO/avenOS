import { jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'
import type { TenantGrantKey } from './grant.js'
import { databaseNameForEnvironment, databaseNameSchema, environmentIdSchema } from './roles.js'

export const workerComponentSchema = z.enum([
	'ceo.aven:component:data:intents@1',
	'os.aven:component:actors:run-repository@1'
])
export const workerPlacementRequestSchema = z
	.object({
		runtimeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
		componentRef: workerComponentSchema,
		after: z.uuid().optional(),
		limit: z.number().int().min(1).max(16).default(16),
		environmentId: environmentIdSchema.optional()
	})
	.strict()
	.refine(
		(input) => !input.environmentId || !input.after,
		'Choose one workspace or a directory page, not both.'
	)
export type WorkerPlacementRequest = z.infer<typeof workerPlacementRequestSchema>
/** Locating a component's queue is service authority, not customer identity or
 * permission to execute its work. Every turn still needs its own work certificate.
 */
export const workerPlacementSchema = z
	.object({
		iss: z.url(),
		aud: workerComponentSchema,
		kind: z.literal('customer-work-placement'),
		runtimeId: workerPlacementRequestSchema.shape.runtimeId,
		componentRef: workerComponentSchema,
		environmentId: environmentIdSchema,
		databaseName: databaseNameSchema,
		routingGeneration: z.number().int().positive(),
		iat: z.number().int().positive(),
		exp: z.number().int().positive()
	})
	.strict()
	.superRefine((claims, context) => {
		if (
			claims.aud !== claims.componentRef ||
			claims.databaseName !== databaseNameForEnvironment(claims.environmentId) ||
			claims.exp <= claims.iat ||
			claims.exp - claims.iat > 60
		)
			context.addIssue({ code: 'custom', message: 'Invalid worker placement.' })
	})
export type WorkerPlacement = z.infer<typeof workerPlacementSchema>
export async function signWorkerPlacement(
	input: Omit<WorkerPlacement, 'iat' | 'exp' | 'aud' | 'kind'>,
	key: TenantGrantKey,
	now = Math.floor(Date.now() / 1000)
): Promise<string> {
	const claims = workerPlacementSchema.parse({
		...input,
		aud: input.componentRef,
		kind: 'customer-work-placement',
		iat: now,
		exp: now + 60
	})
	return new SignJWT(claims)
		.setProtectedHeader({ alg: 'EdDSA', typ: 'aven-placement+jwt' })
		.sign(key)
}
export async function verifyWorkerPlacement(
	token: string,
	key: TenantGrantKey,
	expected: { issuer: string; runtimeId: string; componentRef: WorkerPlacement['componentRef'] }
): Promise<WorkerPlacement> {
	if (token.length > 4096) throw Error('Invalid worker placement.')
	const { payload, protectedHeader } = await jwtVerify(token, key, {
		issuer: expected.issuer,
		audience: expected.componentRef,
		algorithms: ['EdDSA'],
		maxTokenAge: '60s'
	})
	const claims = workerPlacementSchema.parse(payload)
	if (protectedHeader.typ !== 'aven-placement+jwt' || claims.runtimeId !== expected.runtimeId)
		throw Error('Worker placement is not for this runtime.')
	return claims
}
