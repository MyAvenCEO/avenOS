import { createHash } from 'node:crypto'
import {
	type ArtifactRunStore,
	artifactRecord,
	clientRunIdentity,
	type RunArtifactDraft,
	type StoredArtifact
} from '@avenos/artifact-store'
import { CredentialStoreError, type CredentialUse } from '@avenos/credential-storage/contracts'
import {
	declaredContentType,
	httpRequestDigest,
	httpResponseSchema,
	parseHttpRequestArtifact
} from '@avenos/http-resources'
import {
	assertSelectedMessage,
	imapQueryResultSchema,
	imapQuerySchema,
	imapReadSchema,
	queryDigest,
	readDigest
} from '@avenos/mail'
import { imapMessageResultSchema, mailMessageSchema } from '@avenos/mail/artifact-types'
import type { createProtectedHttpExchange } from './http'

const denied = () => new CredentialStoreError('CONNECTION_ARTIFACT_MISMATCH')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type Source = { artifactId: string; artifactDigest: string }
type HttpObservation = Awaited<ReturnType<ReturnType<typeof createProtectedHttpExchange>>>

/** Host-only publication/lookup. The client is scoped by verified tenant authority.
 * Publisher identity is configured by the Store, never taken from an Actor payload.
 * This adapter grants no authority to perform a network operation. */
export class ConnectionArtifacts {
	constructor(
		readonly store: ArtifactRunStore,
		private readonly publisher: { issuer: string; subject: string },
		private readonly authorize: (use: CredentialUse) => Promise<void>
	) {}
	/** Bind the publication barrier to the host request, including cancellation
	 * arriving after blob staging but before the immutable commit. */
	withSignal(signal: AbortSignal) {
		return new ConnectionArtifacts(this.store, this.publisher, async (use) => {
			signal.throwIfAborted()
			await this.authorize(use)
			signal.throwIfAborted()
		})
	}

	private scope(use: CredentialUse) {
		if (use.publicationScopeId !== this.store.scope) throw denied()
	}
	private async exact(source: Source, type: string) {
		const artifact = await this.store.get(source.artifactId)
		if (
			artifact.typeKey !== type ||
			artifact.typeVersion !== 1 ||
			artifact.artifactSha256 !== source.artifactDigest
		)
			throw denied()
		return artifact
	}
	private async reference(artifact: StoredArtifact, role: string, source?: Source) {
		const record = artifactRecord(
			await this.store.client.references(this.store.scope, artifact.artifactId)
		)
		if (record.artifactId !== artifact.artifactId || !Array.isArray(record.references))
			throw denied()
		const refs = record.references.filter((r: any) => r.role === role)
		if (!source) {
			if (refs.length) throw denied()
			return
		}
		if (
			refs.length !== 1 ||
			refs[0].ordinal !== 0 ||
			refs[0].artifactId !== source.artifactId ||
			refs[0].artifactSha256 !== source.artifactDigest
		)
			throw denied()
	}
	private async trustedPublication(artifact: StoredArtifact) {
		const details = artifactRecord(
			await this.store.client.publication(this.store.scope, artifact.publicationId)
		)
		const publication = artifactRecord(details.publication)
		const publisher = artifactRecord(publication.publisher)
		if (
			publisher.issuer !== this.publisher.issuer ||
			publisher.subject !== this.publisher.subject ||
			publication.scopeId !== this.store.scope ||
			publication.runId !== artifact.producerRunId ||
			!Array.isArray(publication.artifacts) ||
			!publication.artifacts.some(
				(a: any) =>
					a.artifactId === artifact.artifactId && a.artifactSha256 === artifact.artifactSha256
			)
		)
			throw denied()
		return artifactRecord(details.run)
	}
	async request(use: CredentialUse): Promise<unknown> {
		this.scope(use)
		await this.authorize(use)
		const type =
			use.requestSchemaId === 'ceo.aven:schema:web:http-request@1'
				? 'web.http-request'
				: use.requestSchemaId === 'ceo.aven:schema:mail:imap-query@1'
					? 'mail.imap-query'
					: use.requestSchemaId === 'ceo.aven:schema:mail:imap-message-request@1'
						? 'mail.imap-message-request'
						: null
		if (!type || (type.startsWith('mail.') ? use.protocol !== 'imap' : use.protocol !== 'http'))
			throw denied()
		const artifact = await this.exact(
			{ artifactId: use.requestOccurrenceId, artifactDigest: use.requestArtifactDigest },
			type
		)
		const parsed =
			type === 'web.http-request'
				? parseHttpRequestArtifact(artifact.payload)
				: type === 'mail.imap-query'
					? imapQuerySchema.parse(artifact.payload)
					: imapReadSchema.parse(artifact.payload)
		const operationDigest =
			type === 'web.http-request'
				? httpRequestDigest(parsed as ReturnType<typeof parseHttpRequestArtifact>)
				: type === 'mail.imap-query'
					? queryDigest(parsed)
					: readDigest(parsed)
		if (operationDigest !== use.operationDigest) throw denied()
		if ('selection' in parsed) await this.reference(artifact, 'selection', parsed.selection)
		else if (type === 'mail.imap-query')
			await this.reference(artifact, 'continuation', imapQuerySchema.parse(parsed).continuation)
		return parsed
	}

	/** Verify the committed query lineage, not an arbitrary payload claiming to be a selection. */
	async selection(use: CredentialUse, source: Source) {
		this.scope(use)
		await this.authorize(use)
		const resultArtifact = await this.exact(source, 'mail.imap-query-result')
		const run = await this.trustedPublication(resultArtifact)
		if (run.procedureKey !== 'mail.imap-query') throw denied()
		const lineage = artifactRecord(
			await this.store.client.producerInputs(this.store.scope, resultArtifact.artifactId)
		)
		if (lineage.producerRunId !== resultArtifact.producerRunId || !Array.isArray(lineage.inputs))
			throw denied()
		const requests = lineage.inputs.filter((i: any) => i.role === 'request')
		if (requests.length !== 1 || requests[0].ordinal !== 0) throw denied()
		const queryArtifact = await this.store.get(requests[0].artifactId)
		if (queryArtifact.typeKey !== 'mail.imap-query' || queryArtifact.typeVersion !== 1)
			throw denied()
		const query = imapQuerySchema.parse(queryArtifact.payload),
			result = imapQueryResultSchema.parse(resultArtifact.payload)
		await this.reference(queryArtifact, 'continuation', query.continuation)
		if (
			queryDigest(query) !== result.queryDigest ||
			query.bindingRef !== result.bindingRef ||
			query.mailbox !== result.mailbox ||
			(!query.continuation && result.scanFromUid !== 1)
		)
			throw denied()
		if (query.continuation) {
			// Previous pages need not be downloaded recursively: only this trusted
			// publisher can establish the checked observation. Check its immediate edge.
			const parent = await this.exact(query.continuation, 'mail.imap-query-result')
			await this.trustedPublication(parent)
			const previous = imapQueryResultSchema.parse(parent.payload)
			if (
				result.scanFromUid !== previous.nextUid ||
				result.upperUidExclusive !== previous.upperUidExclusive ||
				result.uidValidity !== previous.uidValidity ||
				result.accountRef !== previous.accountRef ||
				!lineage.inputs.some(
					(i: any) =>
						i.role === 'selection' && i.artifactId === parent.artifactId && i.ordinal === 0
				)
			)
				throw denied()
		}
		return { query, result }
	}

	private publicationId(use: CredentialUse) {
		this.scope(use)
		return clientRunIdentity(
			JSON.stringify(['connection-result-v1', this.store.scope, use.invocationId])
		)
	}
	async lookup(use: CredentialUse) {
		await this.authorize(use)
		const id = await this.publicationId(use)
		const artifacts = await this.store.lookup(id)
		if (!artifacts) return null
		if (!artifacts.length) throw denied()
		const run = await this.trustedPublication(artifacts[0]!)
		if (
			run.parameters.requestOccurrenceId !== use.requestOccurrenceId ||
			run.parameters.requestArtifactDigest !== use.requestArtifactDigest ||
			run.parameters.operationDigest !== use.operationDigest ||
			run.receipt.protocol !== use.protocol ||
			run.receipt.invocationId !== use.invocationId ||
			run.receipt.bindingRef !== use.bindingRef ||
			run.receipt.bindingRevision !== use.bindingRevision ||
			run.receipt.secretVersion !== use.secretVersion ||
			run.receipt.policyRevision !== use.policyRevision
		)
			throw denied()
		return artifacts
	}
	private async publish(
		use: CredentialUse,
		procedure: string,
		artifacts: RunArtifactDraft[],
		selection?: Source
	) {
		this.scope(use)
		await this.authorize(use)
		return this.store.publish({
			beforeCommit: () => this.authorize(use),
			id: await this.publicationId(use),
			procedure,
			principal: use.subjectId,
			inputs: [
				{ id: use.requestOccurrenceId, role: 'request' },
				...(selection ? [{ id: selection.artifactId, role: 'selection' }] : [])
			],
			parameters: {
				requestOccurrenceId: use.requestOccurrenceId,
				requestArtifactDigest: use.requestArtifactDigest,
				operationDigest: use.operationDigest
			},
			executor: { kind: 'service', id: 'credential-executor' },
			implementation: { adapter: 'protected-connection', version: 1 },
			receipt: {
				outcome: 'succeeded',
				protocol: use.protocol,
				authorizationId: use.authorizationId,
				reviewRequestId: use.reviewRequestId,
				reviewDecisionId: use.reviewDecisionId,
				invocationId: use.invocationId,
				attemptId: use.attemptId,
				bindingRef: use.bindingRef,
				bindingRevision: use.bindingRevision,
				secretVersion: use.secretVersion,
				policyRevision: use.policyRevision
			},
			artifacts
		})
	}
	async publishHttp(use: CredentialUse, observation: HttpObservation) {
		const request = parseHttpRequestArtifact(await this.request(use))
		if (use.protocol !== 'http' || observation.outcome !== 'captured') throw denied()
		const headers = new Headers(
			observation.headers.map((h) => [h.name, h.values.join(', ')] as [string, string])
		)
		const contentType = declaredContentType(headers)
		if (
			(request.method === 'HEAD' || [204, 205, 304].includes(observation.status)) &&
			observation.body.length
		)
			throw denied()
		const payload = httpResponseSchema.parse({
			requestedUrl: request.url,
			finalUrl: request.url,
			statusCode: observation.status,
			protocol: observation.protocol,
			cacheDisposition: 'new',
			declaredMediaType: contentType.mediaType,
			declaredCharset: contentType.charset,
			etag: headers.get('etag'),
			lastModified: headers.get('last-modified'),
			headers: observation.headers,
			redirectCount: 0,
			...(observation.status >= 300 && observation.status < 400
				? { redirectStoppedReason: 'manual' }
				: {}),
			storedBodyLength: observation.body.length,
			capturedAt: observation.capturedAt
		})
		return this.publish(use, 'web.http-fetch', [
			{
				key: 'response',
				type: 'web.http-response',
				payload,
				bytes: observation.body,
				mediaType: contentType.mediaType ?? 'application/octet-stream'
			}
		])
	}
	async publishImap(use: CredentialUse, observation: unknown) {
		const request = await this.request(use)
		if (use.protocol !== 'imap') throw denied()
		if (use.requestSchemaId === 'ceo.aven:schema:mail:imap-query@1') {
			const query = imapQuerySchema.parse(request),
				result = imapQueryResultSchema.parse(observation)
			if (
				queryDigest(query) !== result.queryDigest ||
				query.bindingRef !== result.bindingRef ||
				query.mailbox !== result.mailbox
			)
				throw denied()
			if (query.continuation) {
				const previous = await this.selection(use, query.continuation)
				const root = { ...query }
				delete root.continuation
				const old = { ...previous.query }
				delete old.continuation
				if (
					queryDigest(root) !== queryDigest(old) ||
					previous.result.coverage === 'complete' ||
					result.scanFromUid !== previous.result.nextUid ||
					result.uidValidity !== previous.result.uidValidity ||
					result.accountRef !== previous.result.accountRef ||
					result.upperUidExclusive !== previous.result.upperUidExclusive
				)
					throw denied()
			} else if (result.scanFromUid !== 1) throw denied()
			return this.publish(
				use,
				'mail.imap-query',
				[{ key: 'result', type: 'mail.imap-query-result', payload: result }],
				query.continuation
			)
		}
		const read = imapReadSchema.parse(request),
			selection = await this.selection(use, read.selection)
		assertSelectedMessage(read, selection.query, selection.result)
		const raw = artifactRecord(observation)
		const result = imapMessageResultSchema.parse({
			accountRef: raw.accountRef,
			mailbox: raw.mailbox,
			uidValidity: raw.uidValidity,
			uid: raw.uid,
			outcome: raw.outcome,
			observedFrom: raw.observedFrom,
			observedUntil: raw.observedUntil
		})
		if (
			result.accountRef !== read.accountRef ||
			result.mailbox !== read.mailbox ||
			result.uidValidity !== read.uidValidity ||
			result.uid !== read.uid
		)
			throw denied()
		const artifacts: RunArtifactDraft[] = []
		if (result.outcome === 'captured') {
			if (
				!(raw.body instanceof Uint8Array) ||
				raw.body.length > Math.min(read.maximumBytes, use.maximumBytes) ||
				digest(raw.body) !== raw.sha256
			)
				throw denied()
			artifacts.push({
				key: 'message',
				type: 'mail.message',
				payload: mailMessageSchema.parse({
					mediaType: raw.mediaType,
					byteLength: raw.body.length,
					sha256: raw.sha256
				}),
				bytes: raw.body,
				mediaType: 'message/rfc822'
			})
		} else if (raw.body !== undefined) throw denied()
		artifacts.push({
			key: 'result',
			type: 'mail.imap-message-result',
			payload: result,
			references: result.outcome === 'captured' ? [{ role: 'message', local: 'message' }] : []
		})
		return this.publish(use, 'mail.imap-read-message', artifacts, read.selection)
	}
}
