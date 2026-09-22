import type pg from 'pg'
import { z } from 'zod'
import {
	bindingProfileSchema,
	type CredentialScope,
	CredentialStoreError,
	type CredentialUse,
	commandReceiptSchema,
	credentialMetadataSchema,
	credentialScopeSchema,
	credentialUseSchema,
	parseCredentialValue
} from './contracts'
import type { SecretEnvelope } from './envelope'

type Connection = Pick<pg.Pool, 'query'>
const uuid = z.uuid()
const expectedVersion = z.number().int().min(0).max(2147483646)
const ref = { credentialRef: uuid, expectedVersion }
const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 || code === 127
	})
// Cryptographic validation belongs to the sealer/unsealer. This bounded shape does
// not grant authority; only the protected executor receives stored envelopes.
const envelope = z
	.object({
		format: z.literal('jwe-rsa-oaep-256-a256gcm-v1'),
		jwe: z
			.object({
				protected: z.string().min(1).max(1024),
				encrypted_key: z.string().min(1).max(1366),
				iv: z.string().length(16),
				ciphertext: z.string().min(1).max(43691),
				tag: z.string().length(22),
				aad: z.string().min(1).max(1024)
			})
			.strict()
	})
	.strict()
const commandSchema = z.union([
	z
		.object({
			action: z.literal('create'),
			...ref,
			expectedVersion: z.literal(0),
			label: z
				.string()
				.trim()
				.min(1)
				.max(256)
				.refine((s) => !hasControlCharacter(s)),
			kind: z.enum(['token', 'password']),
			envelope
		})
		.strict(),
	z.object({ action: z.literal('rotate'), ...ref, envelope }).strict(),
	z.object({ action: z.literal('revoke'), ...ref }).strict(),
	z
		.object({
			action: z.literal('binding-set'),
			...ref,
			bindingRef: uuid,
			protocol: z.enum(['http', 'imap']),
			profile: z.unknown()
		})
		.strict()
		.transform((value, ctx) => {
			const result = bindingProfileSchema.safeParse({
				protocol: value.protocol,
				profile: value.profile
			})
			if (!result.success) {
				ctx.addIssue({ code: 'custom', message: 'Invalid binding' })
				return z.NEVER
			}
			return { ...value, ...result.data }
		}),
	z
		.object({
			action: z.literal('binding-revoke'),
			...ref,
			bindingRef: uuid,
			protocol: z.enum(['http', 'imap'])
		})
		.strict()
])
export type SealedCredentialCommand = z.input<typeof commandSchema>

const metadataSchema = z
	.object({
		credentials: z.array(credentialMetadataSchema),
		bindings: z.array(
			z
				.object({
					bindingRef: uuid,
					credentialRef: uuid,
					revision: z.number().int().positive(),
					enabled: z.boolean(),
					protocol: z.enum(['http', 'imap']),
					profile: z.unknown()
				})
				.strict()
				.transform((value, ctx) => {
					const result = bindingProfileSchema.safeParse({
						protocol: value.protocol,
						profile: value.profile
					})
					if (!result.success) {
						ctx.addIssue({ code: 'custom', message: 'Invalid binding' })
						return z.NEVER
					}
					return { ...value, ...result.data }
				})
		)
	})
	.strict()

const safeCodes = new Set([
	'CREDENTIAL_SCOPE_INVALID',
	'CREDENTIAL_INPUT_INVALID',
	'CREDENTIAL_COMMAND_CONFLICT',
	'CREDENTIAL_VERSION_CONFLICT',
	'CREDENTIAL_NOT_USABLE',
	'CREDENTIAL_USE_DENIED',
	'CREDENTIAL_USE_CONFLICT',
	'CREDENTIAL_UNIT_ORDER_INVALID',
	'CREDENTIAL_PREVIOUS_UNIT_UNSETTLED',
	'CREDENTIAL_USE_SETTLED',
	'CREDENTIAL_FENCE_INCONSISTENT',
	'CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING'
])
async function call(db: Connection, fn: string, args: unknown[]) {
	try {
		const result = await db.query(
			`SELECT aven_credentials.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`,
			args
		)
		return result.rows[0]?.value
	} catch (error) {
		const code =
			error instanceof Error && safeCodes.has(error.message)
				? error.message
				: 'CREDENTIAL_STORE_UNAVAILABLE'
		throw new CredentialStoreError(code)
	}
}

/** Public metadata/admin adapters have no method or SQL grant to retrieve ciphertext. */
export class CredentialMetadataStore {
	protected readonly scope: CredentialScope
	constructor(
		protected readonly db: Connection,
		scope: CredentialScope
	) {
		this.scope = parseCredentialValue(credentialScopeSchema, scope)
	}
	async metadata() {
		return parseCredentialValue(
			metadataSchema,
			await call(this.db, 'metadata', [
				this.scope.environmentId,
				this.scope.subjectId,
				this.scope.generation
			])
		)
	}
}
export class CredentialAdminStore {
	private readonly scope: CredentialScope
	constructor(
		private readonly db: Connection,
		scope: CredentialScope
	) {
		this.scope = parseCredentialValue(credentialScopeSchema, scope)
	}
	async command(commandId: string, raw: SealedCredentialCommand) {
		const id = parseCredentialValue(uuid, commandId),
			command = parseCredentialValue(commandSchema, raw)
		return parseCredentialValue(
			commandReceiptSchema,
			await call(this.db, 'admin_command', [
				this.scope.environmentId,
				this.scope.subjectId,
				this.scope.generation,
				id,
				command
			])
		)
	}
	async receipt(commandId: string) {
		const value = await call(this.db, 'command_receipt', [
			this.scope.environmentId,
			this.scope.subjectId,
			this.scope.generation,
			parseCredentialValue(uuid, commandId)
		])
		return value === null ? null : parseCredentialValue(commandReceiptSchema, value)
	}
}

const unit = z
	.object({ ordinal: z.number().int().min(0).max(127), digest: z.string().regex(/^[a-f0-9]{64}$/) })
	.strict()
const claimSchema = z.discriminatedUnion('outcome', [
	z
		.object({
			outcome: z.literal('claimed'),
			envelope,
			kind: z.enum(['token', 'password']),
			profile: z.unknown()
		})
		.strict(),
	z
		.object({
			outcome: z.literal('already-claimed'),
			state: z.enum(['claimed', 'succeeded', 'failed', 'uncertain'])
		})
		.strict()
])

/** Protected-executor adapter only. Signed authority verification and request/profile
 * matching must precede this port. It is not a public route or ordinary Actor port. */
export class CredentialUseStore {
	private readonly scope: CredentialScope
	constructor(
		private readonly db: Connection,
		scope: CredentialScope,
		private readonly protocol: 'http' | 'imap'
	) {
		this.scope = parseCredentialValue(credentialScopeSchema, scope)
		parseCredentialValue(z.enum(['http', 'imap']), protocol)
	}
	async claim(raw: CredentialUse, ordinal: number, digest: string) {
		const authority = parseCredentialValue(credentialUseSchema, raw)
		parseCredentialValue(unit, { ordinal, digest })
		if (
			authority.environmentId !== this.scope.environmentId ||
			authority.subjectId !== this.scope.subjectId ||
			authority.protocol !== this.protocol
		)
			throw new CredentialStoreError('CREDENTIAL_USE_DENIED')
		const value = parseCredentialValue(
			claimSchema,
			await call(this.db, `claim_${this.protocol}`, [authority, ordinal, digest])
		)
		if (value.outcome === 'already-claimed') return value
		const profile = parseCredentialValue(bindingProfileSchema, {
			protocol: this.protocol,
			profile: value.profile
		})
		return { ...value, envelope: value.envelope as SecretEnvelope, ...profile }
	}
	async finish(
		authorizationId: string,
		ordinal: number,
		digest: string,
		state: 'succeeded' | 'failed' | 'uncertain'
	) {
		parseCredentialValue(unit, { ordinal, digest })
		parseCredentialValue(z.enum(['succeeded', 'failed', 'uncertain']), state)
		await call(this.db, `finish_${this.protocol}`, [
			this.scope.environmentId,
			this.scope.subjectId,
			parseCredentialValue(uuid, authorizationId),
			ordinal,
			digest,
			state
		])
	}
	/** Host-only shutdown accounting, not permission to retry an uncertain use. */
	async settle(authorizationId: string) {
		await call(this.db, `settle_${this.protocol}`, [
			this.scope.environmentId,
			this.scope.subjectId,
			parseCredentialValue(uuid, authorizationId)
		])
	}
}
