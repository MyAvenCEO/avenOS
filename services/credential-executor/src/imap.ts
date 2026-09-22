import { createHash } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import type { createCredentialUnsealer } from '@avenos/credential-storage'
import { CredentialStoreError, type CredentialUse } from '@avenos/credential-storage/contracts'
import type { CredentialUseStore } from '@avenos/credential-storage/postgres'
import { pinDestination } from '@avenos/http-resources'
import {
	assertSelectedMessage,
	type ImapQuery,
	type ImapQueryResult,
	imapQueryResultSchema,
	imapQuerySchema,
	imapReadSchema,
	nextUidWindow,
	queryDigest,
	readDigest
} from '@avenos/mail'
import { ImapFlow, type SearchObject } from 'imapflow'

export interface ImapExecutorPorts {
	verify(token: string): Promise<CredentialUse>
	authorize(use: CredentialUse): Promise<void>
	store(use: CredentialUse): Promise<CredentialUseStore>
	/** Protected host ownership hook; invoked only after winning the first SQL claim. */
	onClaim(use: CredentialUse): void
	request(use: CredentialUse): Promise<unknown>
	/** Read the committed selection/continuation under current authority, never caller JSON. */
	selection(
		use: CredentialUse,
		source: { artifactId: string; artifactDigest: string }
	): Promise<{ query: unknown; result: unknown }>
	unsealer: ReturnType<typeof createCredentialUnsealer>
	/** Deployment-owned exact TLS endpoints, represented as https origins for shared DNS policy. */
	allowedOrigins: readonly string[]
	localTestOrigins?: readonly string[]
	observe?(event: { stage: string; command?: string; ordinal?: number }): void
}

// ImapFlow 2.0.5's single exec boundary is intentionally pinned. No raw-command API
// escapes this module. New automatic commands fail closed until reviewed and tested.
type GuardedClient = ImapFlow & {
	exec(command: string, attributes: unknown, options: unknown): Promise<unknown>
	socket: TLSSocket | false
}
const allowed = new Set([
	'CAPABILITY',
	'ID',
	'LOGIN',
	'NAMESPACE',
	'LIST',
	'LSUB',
	'EXAMINE',
	'UID SEARCH',
	'UID FETCH'
])
const denied = () => new CredentialStoreError('CREDENTIAL_IMAP_OPERATION_DENIED')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createProtectedImapOperation(ports: ImapExecutorPorts) {
	return async (token: string, parentSignal: AbortSignal) => {
		const use = await ports.verify(token)
		const queryOperation = use.capabilityId === 'ceo.aven:capability:mail.imap-mailbox:imap_query@1'
		if (
			use.protocol !== 'imap' ||
			(!queryOperation &&
				use.capabilityId !== 'ceo.aven:capability:mail.imap-mailbox:imap_read_message@1') ||
			use.requestSchemaId !==
				(queryOperation
					? 'ceo.aven:schema:mail:imap-query@1'
					: 'ceo.aven:schema:mail:imap-message-request@1')
		)
			throw denied()
		const raw = await ports.request(use)
		const query = queryOperation ? imapQuerySchema.parse(raw) : null
		const read = queryOperation ? null : imapReadSchema.parse(raw)
		const request = query ?? read!
		if (
			(query ? queryDigest(query) : readDigest(read)) !== use.operationDigest ||
			request.bindingRef !== use.bindingRef ||
			request.purpose !== use.purpose ||
			/[%*]/.test(request.mailbox)
		)
			throw denied()
		let previous: ImapQueryResult | undefined
		if (read || query?.continuation) {
			const source = await ports.selection(use, read ? read.selection : query!.continuation!)
			const selectedQuery = imapQuerySchema.parse(source.query),
				selectedResult = imapQueryResultSchema.parse(source.result)
			if (read) assertSelectedMessage(read, selectedQuery, selectedResult)
			else {
				const original = { ...selectedQuery }
				delete original.continuation
				const continuation = { ...query! }
				delete continuation.continuation
				if (
					queryDigest(original) !== queryDigest(continuation) ||
					selectedResult.queryDigest !== queryDigest(selectedQuery) ||
					selectedResult.coverage === 'complete'
				)
					throw denied()
			}
			previous = selectedResult
		}
		const store = await ports.store(use)
		await ports.authorize(use)
		parentSignal.throwIfAborted()
		const bootstrapDigest = hash(['imap-session-v1', use.operationDigest])
		const initial = await store.claim(use, 0, bootstrapDigest)
		if (initial.outcome === 'already-claimed') return initial
		let client: GuardedClient | undefined,
			connection: TLSSocket | undefined,
			secretBytes: Uint8Array | undefined,
			timer: ReturnType<typeof setTimeout> | undefined
		const abort = new AbortController(),
			signal = AbortSignal.any([parentSignal, abort.signal])
		const close = () => client?.close()
		let bootstrapFinished = false,
			ordinal = 1
		try {
			ports.onClaim(use)
			if (initial.protocol !== 'imap' || initial.kind !== 'password') throw denied()
			const profile = initial.profile
			if (
				!profile.mailboxes.includes(request.mailbox) ||
				profile.purpose !== use.purpose ||
				!profile.operations.includes(query ? 'query' : 'read-message') ||
				use.maximumUnits > profile.maximumCommands ||
				use.maximumBytes > profile.maximumBytes ||
				(read && read.accountRef !== profile.accountRef) ||
				(previous &&
					(previous.accountRef !== profile.accountRef || previous.mailbox !== request.mailbox))
			)
				throw denied()
			const deadline = Math.min(
				Date.parse(use.expiresAt),
				Date.now() + 1000 * Math.min(profile.maximumSeconds, query?.limits.maximumSeconds ?? 120)
			)
			timer = setTimeout(() => abort.abort(), Math.max(1, deadline - Date.now()))
			signal.addEventListener('abort', close, { once: true })
			signal.throwIfAborted()
			ports.observe?.({ stage: 'resolve' })
			const pinned = await pinDestination(
				new URL(`https://${profile.host}:${profile.port}`),
				ports,
				signal
			)
			ports.observe?.({ stage: 'unseal' })
			secretBytes = await ports.unsealer.unseal(initial.envelope, {
				environmentId: use.environmentId,
				ownerSubjectId: use.subjectId,
				credentialRef: use.credentialRef,
				kind: initial.kind,
				secretVersion: use.secretVersion
			})
			client = new ImapFlow({
				host: pinned.address,
				port: profile.port,
				servername: profile.host,
				secure: true,
				tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
				auth: {
					user: profile.login,
					pass: new TextDecoder('utf-8', { fatal: true }).decode(secretBytes),
					loginMethod: 'LOGIN'
				},
				logger: false,
				logRaw: false,
				emitLogs: false,
				disableAutoIdle: true,
				disableAutoEnable: true,
				disableCompression: true,
				disableBinary: true,
				disableIMAP4rev2: true,
				doSTARTTLS: false,
				maxLineLength: 65536,
				maxLiteralSize: Math.min(use.maximumBytes + 1, 32 * 1024 * 1024 + 1),
				maxResponseSize: Math.min(use.maximumBytes + 65536, 33 * 1024 * 1024),
				connectionTimeout: Math.max(1, deadline - Date.now()),
				greetingTimeout: 10000,
				socketTimeout: 15000
			}) as GuardedClient
			client.on('error', () => {}) // Never forward provider strings or authentication diagnostics.
			const originalExec = client.exec.bind(client)
			client.exec = async (command, attributes, options) => {
				ports.observe?.({ stage: 'command', command, ordinal })
				if (
					!allowed.has(command) ||
					ordinal >= Math.min(use.maximumUnits, query?.limits.maximumCommands ?? 128)
				) {
					close()
					throw denied()
				}
				const index = ordinal++,
					digest = hash(['imap-command-v1', use.operationDigest, index, command])
				// Attributes contain LOGIN passwords. Do not persist/log/hash those attributes.
				try {
					signal.throwIfAborted()
					await ports.verify(token)
					await ports.authorize(use)
					const claim = await store.claim(use, index, digest)
					if (claim.outcome !== 'claimed' || claim.protocol !== 'imap') throw denied()
					try {
						signal.throwIfAborted()
						const result = await originalExec(command, attributes, options)
						await store.finish(use.authorizationId, index, digest, 'succeeded')
						return result
					} catch {
						await store.finish(use.authorizationId, index, digest, 'uncertain').catch(() => {})
						throw denied()
					}
				} catch {
					close()
					throw denied()
				}
			}
			await store.finish(use.authorizationId, 0, bootstrapDigest, 'succeeded')
			bootstrapFinished = true
			ports.observe?.({ stage: 'connect' })
			const connecting = client.connect()
			// No proxy/async connector is configured: the socket exists synchronously.
			// Count all plaintext protocol bytes, including greeting and unsolicited data.
			if (!client.socket) {
				close()
				await connecting.catch(() => {})
				throw denied()
			}
			connection = client.socket
			let received = 0
			const wireLimit = use.maximumBytes + 262144
			client.socket.prependListener('data', (chunk: Buffer) => {
				received += chunk.length
				if (received > wireLimit) abort.abort()
			})
			await connecting
			signal.throwIfAborted()
			ports.observe?.({ stage: 'open-mailbox' })
			const mailbox = await client.mailboxOpen(request.mailbox, { readOnly: true })
			const epoch = Number(mailbox.uidValidity),
				upper = mailbox.uidNext
			if (
				!mailbox.readOnly ||
				mailbox.path !== request.mailbox ||
				!Number.isInteger(epoch) ||
				epoch < 1 ||
				epoch > 4294967295 ||
				!Number.isInteger(upper) ||
				upper < 1 ||
				upper > 4294967296 ||
				(previous && previous.uidValidity !== epoch) ||
				(read && read.uidValidity !== epoch)
			)
				throw denied()
			let output: unknown
			ports.observe?.({ stage: 'query-or-read' })
			if (query) {
				const result: ImapQueryResult = {
					accountRef: profile.accountRef,
					mailbox: request.mailbox,
					uidValidity: epoch,
					bindingRef: use.bindingRef,
					queryDigest: queryDigest(query),
					upperUidExclusive: previous?.upperUidExclusive ?? upper,
					scanFromUid: previous?.nextUid ?? 1,
					nextUid: previous?.nextUid ?? 1,
					scanned: [],
					messages: [],
					coverage: 'complete',
					stopReason: null,
					observedFrom: new Date().toISOString(),
					observedUntil: new Date().toISOString()
				}
				while (result.nextUid < result.upperUidExclusive) {
					// Reserve SEARCH+FETCH; never start a window we cannot finish.
					if (ordinal + 2 > Math.min(use.maximumUnits, query.limits.maximumCommands)) {
						result.stopReason = 'command-limit'
						break
					}
					const range = nextUidWindow(
						result.nextUid,
						result.upperUidExclusive,
						query.limits.maximumMatches - result.messages.length
					)
					if (!range) {
						result.stopReason = 'match-limit'
						break
					}
					const criteria: SearchObject = { uid: `${range.first}:${range.last}` }
					if (query.criteria.internalDate?.since) criteria.since = query.criteria.internalDate.since
					if (query.criteria.internalDate?.before)
						criteria.before = query.criteria.internalDate.before
					if (query.criteria.fromContains) criteria.from = query.criteria.fromContains
					if (query.criteria.subjectContains) criteria.subject = query.criteria.subjectContains
					if (query.criteria.seen !== 'any') criteria.seen = query.criteria.seen === 'seen'
					const found = await client.search(criteria, { uid: true })
					if (
						!Array.isArray(found) ||
						found.length > range.last - range.first + 1 ||
						new Set(found).size !== found.length ||
						found.some((uid) => !Number.isInteger(uid) || uid < range.first || uid > range.last)
					)
						throw denied()
					found.sort((a, b) => a - b)
					const fetched = found.length
						? await client.fetchAll(
								found.join(','),
								{
									uid: true,
									internalDate: query.metadata.includes('internal-date'),
									size: query.metadata.includes('size'),
									flags: query.metadata.includes('flags')
								},
								{ uid: true }
							)
						: []
					if (
						fetched.some((row) => !found.includes(row.uid)) ||
						new Set(fetched.map((row) => row.uid)).size !== fetched.length
					)
						throw denied()
					const rows: ImapQueryResult['messages'] = found.map((uid) => {
						const row = fetched.find((row) => row.uid === uid)
						if (!row) return { uid, state: 'missing' }
						return {
							uid,
							state: 'present',
							...(query.metadata.includes('internal-date') && row.internalDate instanceof Date
								? { internalDate: row.internalDate.toISOString() }
								: {}),
							...(query.metadata.includes('size') && typeof row.size === 'number'
								? { size: row.size }
								: {}),
							...(query.metadata.includes('flags') && row.flags
								? { flags: [...row.flags].sort() }
								: {})
						}
					})
					// Do not advance the cursor when the current window cannot be retained.
					if (
						Buffer.byteLength(
							JSON.stringify({
								...result,
								messages: [...result.messages, ...rows],
								scanned: [...result.scanned, range]
							})
						) >
						Math.min(use.maximumBytes, query.limits.maximumResultBytes) - 256
					) {
						result.stopReason = 'result-byte-limit'
						break
					}
					result.messages.push(...rows)
					result.scanned.push(range)
					result.nextUid = range.last + 1
					if (
						rows.some(
							(row) =>
								row.state === 'missing' ||
								(row.state === 'present' &&
									query.metadata.some((field) =>
										field === 'internal-date'
											? row.internalDate === undefined
											: field === 'size'
												? row.size === undefined
												: row.flags === undefined
									))
						)
					) {
						result.stopReason = 'missing-metadata'
						break
					}
				}
				result.coverage =
					result.stopReason === 'missing-metadata'
						? 'incomplete'
						: result.stopReason
							? 'truncated'
							: 'complete'
				result.observedUntil = new Date().toISOString()
				output = imapQueryResultSchema.parse(result)
			} else {
				const observedFrom = new Date().toISOString()
				const message = await client.fetchOne(
					String(read!.uid),
					{ uid: true, size: true, source: { start: 0, maxLength: read!.maximumBytes + 1 } },
					{ uid: true }
				)
				if (!message)
					output = {
						outcome: 'unavailable',
						observedFrom,
						observedUntil: new Date().toISOString(),
						accountRef: profile.accountRef,
						mailbox: read!.mailbox,
						uidValidity: epoch,
						uid: read!.uid
					}
				else {
					if (
						message.uid !== read!.uid ||
						!message.source ||
						message.source.length > Math.min(read!.maximumBytes, use.maximumBytes) ||
						message.source.length !== message.size ||
						message.source.includes(Buffer.from(secretBytes))
					)
						throw denied()
					output = {
						outcome: 'captured',
						observedFrom,
						observedUntil: new Date().toISOString(),
						accountRef: profile.accountRef,
						mailbox: read!.mailbox,
						uidValidity: epoch,
						uid: read!.uid,
						mediaType: 'message/rfc822',
						body: message.source,
						sha256: createHash('sha256').update(message.source).digest('hex')
					}
				}
			}
			signal.throwIfAborted()
			await ports.verify(token)
			await ports.authorize(use)
			await store.claim(use, 0, bootstrapDigest) // Recheck current binding before releasing observed content.
			return output
		} catch {
			if (!bootstrapFinished)
				await store.finish(use.authorizationId, 0, bootstrapDigest, 'failed').catch(() => {})
			throw new CredentialStoreError('CREDENTIAL_IMAP_OPERATION_FAILED')
		} finally {
			clearTimeout(timer)
			signal.removeEventListener('abort', close)
			secretBytes?.fill(0)
			// Do not release lifecycle ownership while the underlying connection can
			// still run protocol callbacks. Register before initiating socket shutdown.
			const socket = connection ?? client?.socket
			const closed =
				socket && !socket.closed
					? new Promise<void>((resolve) => socket.once('close', () => resolve()))
					: Promise.resolve()
			close()
			if (socket && !socket.destroyed) socket.destroy()
			await closed
		}
	}
}
