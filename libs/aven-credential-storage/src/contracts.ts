import { normalizeBinding } from '@avenos/http-resources/vault'
import { z } from 'zod'

const uuid = z.uuid().transform((s) => s.toLowerCase())
const version = z.number().int().min(1).max(2147483647)
const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 || code === 127
	})
const text = (maximum: number) =>
	z
		.string()
		.min(1)
		.max(maximum)
		.refine((s) => !hasControlCharacter(s))
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const iso = z.iso.datetime({ offset: true })

export const credentialScopeSchema = z
	.object({ environmentId: uuid, subjectId: uuid, generation: version })
	.strict()
export type CredentialScope = z.infer<typeof credentialScopeSchema>

// No endpoint, login, or remote account is supplied by an ordinary Actor.
export const imapProfileSchema = z
	.object({
		label: text(256),
		host: z
			.string()
			.max(253)
			.regex(/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62})$/),
		port: z.number().int().min(1).max(65535),
		tls: z.literal('implicit'),
		authentication: z.literal('password'),
		login: text(320),
		accountRef: uuid,
		mailboxes: z
			.array(text(1024))
			.min(1)
			.max(32)
			.refine((v) => new Set(v).size === v.length),
		operations: z
			.array(z.enum(['query', 'read-message']))
			.min(1)
			.max(2)
			.refine((v) => new Set(v).size === v.length),
		purpose: text(128),
		maximumCommands: z.number().int().min(1).max(128),
		maximumBytes: z
			.number()
			.int()
			.min(1)
			.max(32 * 1024 * 1024),
		maximumSeconds: z.number().int().min(1).max(120)
	})
	.strict()
export type ImapProfile = z.infer<typeof imapProfileSchema>

const httpProfileSchema = z.unknown().transform((input, ctx) => {
	// Reuse the HTTP attachment/path/host validator rather than create a second policy.
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		ctx.addIssue({ code: 'custom', message: 'Invalid HTTP binding' })
		return z.NEVER
	}
	const reserved = ['bindingRef', 'credentialRef', 'ownerSubjectId', 'enabled']
	if (reserved.some((key) => Object.hasOwn(input, key))) {
		ctx.addIssue({ code: 'custom', message: 'Invalid HTTP binding' })
		return z.NEVER
	}
	try {
		const ref = '00000000-0000-4000-8000-000000000001'
		const { bindingRef, credentialRef, ownerSubjectId, enabled, ...profile } = normalizeBinding({
			...input,
			bindingRef: ref,
			credentialRef: ref,
			ownerSubjectId: ref,
			enabled: true
		} as Parameters<typeof normalizeBinding>[0])
		if (
			profile.placements.length !== 1 ||
			profile.placements[0] !== 'server' ||
			profile.schemes.length !== 1 ||
			profile.schemes[0] !== 'https'
		)
			throw Error('server TLS only')
		return profile
	} catch {
		ctx.addIssue({ code: 'custom', message: 'Invalid HTTP binding' })
		return z.NEVER
	}
})

export const bindingProfileSchema = z.discriminatedUnion('protocol', [
	z.object({ protocol: z.literal('http'), profile: httpProfileSchema }).strict(),
	z.object({ protocol: z.literal('imap'), profile: imapProfileSchema }).strict()
])
export type BindingProfile = z.infer<typeof bindingProfileSchema>

// A private decision descriptor, never a bearer or model-visible artifact.
// The fixed executor verifies its signed envelope before using this value in SQL.
export const credentialUseSchema = z
	.object({
		authorizationId: uuid,
		environmentId: uuid,
		subjectId: uuid,
		sessionId: text(256),
		generation: version,
		runId: uuid,
		leaseOwnerId: uuid,
		protocol: z.enum(['http', 'imap']),
		capabilityId: text(256),
		invocationId: uuid,
		attemptId: uuid,
		callerActorId: text(256),
		parentInvocationIds: z.array(uuid).max(16),
		bindingRef: uuid,
		bindingRevision: version,
		credentialRef: uuid,
		secretVersion: version,
		requestOccurrenceId: uuid,
		requestArtifactDigest: digest,
		requestSchemaId: text(256),
		operationDigest: digest,
		purpose: text(128),
		policyRevision: version,
		reviewRequestId: uuid,
		reviewDecisionId: uuid,
		mode: z.enum(['productive', 'trial']),
		publicationScopeId: uuid,
		maximumUnits: z.number().int().min(1).max(128),
		maximumBytes: z
			.number()
			.int()
			.min(1)
			.max(32 * 1024 * 1024),
		issuedAt: iso,
		expiresAt: iso
	})
	.strict()
	.superRefine((value, ctx) => {
		const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt)
		if (lifetime <= 0 || lifetime > 300_000)
			ctx.addIssue({ code: 'custom', message: 'Invalid use lifetime' })
	})
export type CredentialUse = z.infer<typeof credentialUseSchema>

export const credentialMetadataSchema = z
	.object({
		credentialRef: uuid,
		label: text(256),
		kind: z.enum(['token', 'password']),
		secretVersion: version,
		enabled: z.boolean(),
		createdAt: iso,
		updatedAt: iso
	})
	.strict()
export type CredentialMetadata = z.infer<typeof credentialMetadataSchema>

export const bindingReceiptSchema = z
	.object({ bindingRef: uuid, revision: version, enabled: z.boolean() })
	.strict()
export const commandReceiptSchema = z.union([credentialMetadataSchema, bindingReceiptSchema])
export type CredentialCommandReceipt = z.infer<typeof commandReceiptSchema>

export class CredentialStoreError extends Error {
	constructor(readonly code: string) {
		super(code)
	}
}

/** Public boundary errors contain no input, SQL detail, crypto cause or secret. */
export function parseCredentialValue<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input)
	if (!result.success) throw new CredentialStoreError('CREDENTIAL_INPUT_INVALID')
	return result.data
}
