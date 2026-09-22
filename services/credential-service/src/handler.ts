import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitCustomerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import type { IdentityVerifier } from '@avenos/aven-identity'
import type { createCredentialSealer } from '@avenos/credential-storage'
import { bindingProfileSchema, CredentialStoreError } from '@avenos/credential-storage/contracts'
import type {
	CredentialAdminStore,
	CredentialMetadataStore,
	SealedCredentialCommand
} from '@avenos/credential-storage/postgres'
import { BodyLimitError, readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'

const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 || code === 127
	})
const text = z
	.string()
	.trim()
	.min(1)
	.max(256)
	.refine((s) => !hasControlCharacter(s))
const ref = { credentialRef: z.uuid(), expectedVersion: z.number().int().min(0).max(2147483646) }
const value = z
	.string()
	.min(1)
	.max(32768)
	.refine((s) => Buffer.byteLength(s) <= 32768)
const commandSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			...ref,
			expectedVersion: z.literal(0),
			label: text,
			kind: z.enum(['token', 'password']),
			value
		})
		.strict(),
	z.object({ action: z.literal('rotate'), ...ref, value }).strict(),
	z.object({ action: z.literal('revoke'), ...ref }).strict(),
	z
		.object({
			action: z.literal('binding-set'),
			...ref,
			bindingRef: z.uuid(),
			protocol: z.enum(['http', 'imap']),
			profile: z.unknown()
		})
		.strict(),
	z
		.object({
			action: z.literal('binding-revoke'),
			...ref,
			bindingRef: z.uuid(),
			protocol: z.enum(['http', 'imap'])
		})
		.strict()
])
const inputSchema = z.object({ commandId: z.uuid(), command: commandSchema }).strict()
const json = (status: number, value: unknown) =>
	Response.json(value, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	})

/** Set-only ingress. No decryption key, use-role root, Actor execution or model port. */
export function createCredentialHandler(
	config: { serviceToken: string; issuer: string; key: TenantGrantKey },
	verifier: Pick<IdentityVerifier, 'verify'>,
	stores: {
		adminFor(grant: TenantGrantClaims): Promise<CredentialAdminStore>
		metadataFor(grant: TenantGrantClaims): Promise<CredentialMetadataStore>
	},
	sealer: ReturnType<typeof createCredentialSealer>
) {
	return async (request: Request) => {
		let bytes: Uint8Array | undefined, plaintext: Buffer | undefined
		try {
			const url = new URL(request.url),
				read = request.method === 'GET'
			if (
				url.search ||
				request.headers.has('cookie') ||
				request.headers.has('origin') ||
				request.headers.has('x-aven-work-grant')
			)
				throw new CustomerAdmissionError()
			const { tenant } = await admitCustomerRequest(request, {
				serviceToken: config.serviceToken,
				identityVerifier: verifier,
				tenantGrantPublicKey: config.key,
				tenantGrantIssuer: config.issuer,
				componentRef: 'ceo.aven:component:data:credentials@1',
				requiredAction: read ? 'credentials:read' : 'credentials:write'
			})
			if (read && url.pathname === '/api/credentials')
				return json(200, await (await stores.metadataFor(tenant)).metadata())
			const receipt = url.pathname.match(/^\/api\/credentials\/commands\/([0-9a-f-]{36})$/)
			if (read && receipt) {
				const id = z.uuid().parse(receipt[1]),
					result = await (await stores.adminFor(tenant)).receipt(id)
				return result
					? json(200, { commandId: id, receipt: result })
					: json(404, { code: 'CREDENTIAL_COMMAND_NOT_FOUND' })
			}
			if (request.method !== 'POST' || url.pathname !== '/api/credentials/commands')
				return json(404, { code: 'ROUTE_NOT_FOUND' })
			if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
				return json(415, { code: 'JSON_REQUIRED' })
			bytes = await readBoundedBytes(request, 96 * 1024)
			const input = inputSchema.parse(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
			)
			bytes.fill(0)
			const admin = await stores.adminFor(tenant),
				old = await admin.receipt(input.commandId)
			if (old) {
				const sameTarget =
					'bindingRef' in old
						? 'bindingRef' in input.command && old.bindingRef === input.command.bindingRef
						: old.credentialRef === input.command.credentialRef
				if (!sameTarget) throw new CredentialStoreError('CREDENTIAL_COMMAND_CONFLICT')
				// Do not claim that a newly supplied password matches or replaced the old
				// one. No plaintext/password digest is retained just to compare retries.
				return json(200, {
					commandId: input.commandId,
					outcome: 'previously-processed',
					receipt: old
				})
			}
			const command = input.command
			let sealed: SealedCredentialCommand
			if (command.action === 'create' || command.action === 'rotate') {
				let kind: 'token' | 'password'
				if (command.action === 'create') kind = command.kind
				else {
					const current = (await (await stores.metadataFor(tenant)).metadata()).credentials.find(
						(c) => c.credentialRef === command.credentialRef
					)
					if (!current || !current.enabled || current.secretVersion !== command.expectedVersion)
						throw new CredentialStoreError('CREDENTIAL_VERSION_CONFLICT')
					kind = current.kind
				}
				plaintext = Buffer.from(command.value)
				const envelope = await sealer.seal(plaintext, {
					environmentId: tenant.environmentId,
					ownerSubjectId: tenant.sub,
					credentialRef: command.credentialRef,
					kind,
					secretVersion: command.action === 'create' ? 1 : command.expectedVersion + 1
				})
				const { value: discard, ...metadata } = command
				sealed = { ...metadata, envelope }
			} else if (command.action === 'binding-set')
				sealed = {
					...command,
					...bindingProfileSchema.parse({ protocol: command.protocol, profile: command.profile })
				}
			else sealed = command
			request.signal.throwIfAborted()
			const result = await admin.command(input.commandId, sealed)
			return json(201, { commandId: input.commandId, outcome: 'applied', receipt: result })
		} catch (error) {
			if (error instanceof CustomerAdmissionError)
				return json(403, { code: 'CREDENTIAL_ACCESS_DENIED' })
			if (error instanceof BodyLimitError) return json(error.status, { code: error.code })
			if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)
				return json(400, { code: 'CREDENTIAL_INPUT_INVALID' })
			if (error instanceof CredentialStoreError) {
				const conflict = [
					'CREDENTIAL_VERSION_CONFLICT',
					'CREDENTIAL_COMMAND_CONFLICT',
					'CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING'
				].includes(error.code)
				const input = error.code === 'CREDENTIAL_INPUT_INVALID'
				return json(conflict ? 409 : input ? 400 : 503, {
					code: conflict || input ? error.code : 'CREDENTIAL_OPERATION_UNAVAILABLE'
				})
			}
			return json(503, { code: 'CREDENTIAL_OPERATION_UNAVAILABLE' })
		} finally {
			bytes?.fill(0)
			plaintext?.fill(0)
		}
	}
}
