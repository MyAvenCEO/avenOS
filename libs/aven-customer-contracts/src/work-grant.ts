import { jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'
import { membershipAllows } from './authorization.js'
import type { TenantGrantKey } from './grant.js'
import { componentRefSchema } from './manifest.js'
import { databaseNameForEnvironment, databaseNameSchema, environmentIdSchema } from './roles.js'

export const WORK_GRANT_AUDIENCE = 'os.aven:executor:actor-runner@1'
export const MAX_WORK_GRANT_SECONDS = 3600
const action = z.string().regex(/^[a-z][a-z0-9:-]{0,80}$/)
const permission = z
	.object({ componentRef: componentRefSchema, actions: z.array(action).min(1).max(8) })
	.strict()

/** Authority for one already-requested turn, not a login token or Source authorization. */
export const workGrantClaimsSchema = z
	.object({
		iss: z.url(),
		aud: z.literal(WORK_GRANT_AUDIENCE),
		jti: z.uuid(),
		sub: z.uuid(),
		sid: z.string().min(1).max(256),
		role: z.enum(['user', 'admin']),
		membershipRole: z.enum(['owner', 'admin', 'member']),
		environmentId: environmentIdSchema,
		databaseName: databaseNameSchema,
		routingGeneration: z.number().int().positive(),
		kind: z.literal('chat-turn'),
		inputId: z.uuid(),
		inputRevision: z.number().int().positive(),
		materialDigest: z.string().regex(/^[a-f0-9]{64}$/),
		permissions: z.array(permission).min(1).max(8),
		iat: z.number().int().positive(),
		exp: z.number().int().positive()
	})
	.strict()
	.superRefine((claims, context) => {
		if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_WORK_GRANT_SECONDS)
			context.addIssue({ code: 'custom', message: 'Work authority has an invalid lifetime.' })
		if (claims.databaseName !== databaseNameForEnvironment(claims.environmentId))
			context.addIssue({
				code: 'custom',
				message: 'Work authority does not match its environment.'
			})
		if (
			new Set(claims.permissions.map((entry) => entry.componentRef)).size !==
			claims.permissions.length
		)
			context.addIssue({ code: 'custom', message: 'Duplicate work permission component.' })
		for (const entry of claims.permissions) {
			if (
				new Set(entry.actions).size !== entry.actions.length ||
				!membershipAllows(claims.membershipRole, entry.componentRef, entry.actions)
			)
				context.addIssue({
					code: 'custom',
					message: 'Work authority exceeds the customer membership policy.'
				})
		}
	})
export type WorkGrantClaims = z.infer<typeof workGrantClaimsSchema>
export type WorkGrantInput = Omit<WorkGrantClaims, 'aud' | 'iat' | 'exp'>

export async function signWorkGrant(
	input: WorkGrantInput,
	key: TenantGrantKey,
	ttlSeconds = MAX_WORK_GRANT_SECONDS,
	nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
	const claims = workGrantClaimsSchema.parse({
		...input,
		aud: WORK_GRANT_AUDIENCE,
		iat: nowSeconds,
		exp: nowSeconds + ttlSeconds
	})
	return new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', typ: 'aven-work+jwt' }).sign(key)
}

export async function verifyWorkGrant(
	token: string,
	key: TenantGrantKey,
	issuer: string
): Promise<WorkGrantClaims> {
	if (token.length > 8192) throw Error('Work authority is too large.')
	const { payload, protectedHeader } = await jwtVerify(token, key, {
		issuer,
		audience: WORK_GRANT_AUDIENCE,
		algorithms: ['EdDSA'],
		maxTokenAge: `${MAX_WORK_GRANT_SECONDS}s`,
		clockTolerance: 2
	})
	if (protectedHeader.typ !== 'aven-work+jwt') throw Error('Invalid work authority type.')
	return workGrantClaimsSchema.parse(payload)
}

/** The exchange also checks current membership, provisioning and routing generation. */
export function workAllows(
	claims: WorkGrantClaims,
	componentRef: string,
	actions: readonly string[]
): boolean {
	const permission = claims.permissions.find((entry) => entry.componentRef === componentRef)
	return (
		actions.length > 0 &&
		Boolean(permission && actions.every((action) => permission.actions.includes(action)))
	)
}
