import {
	Actor,
	type ActorStepPayload,
	type PlanRunExecutionContext,
	type PlanRunStartRequest
} from '@avenos/actors'
import { readBoundedBytes } from '@avenos/http-boundary'
import { publicConnectionCatalog } from '@avenos/http-resources'
import { parseHttpRequestArtifact } from '@avenos/http-resources/contracts'
import { imapQueryResultSchema, imapQuerySchema, imapReadSchema } from '@avenos/mail'
import { decodeJwt } from 'jose'
import { z } from 'zod'
import type { AdmittedExecutionRecord, AdmittedInvocations } from './admitted-invocations'
import { stablePublicationUuid } from './artifact-store-port'
import {
	CONNECTION_CATALOG_MANIFEST,
	connectionCapabilities,
	HTTP_CONNECTION_MANIFEST,
	IMAP_CONNECTION_MANIFEST
} from './connection-manifests'
import { installedFactory } from './installed-runtime'
import { type ReviewStore, requestRunReview } from './reviews'
import { type StudioArtifact, type StudioArtifacts, studioObject } from './studio-artifacts'

export interface ConnectionRuntimeConfig {
	metadataUrl: string
	policyUrl: string
	policyToken: string
	http: { url: string; token: string }
	imap: { url: string; token: string }
	publisher: { issuer: string; subject: string }
}
const preparedSchema = z
	.object({
		subject: z.record(z.string(), z.unknown()),
		subjectSchema: z.string().min(1),
		subjectDigest: z.string().regex(/^[a-f0-9]{64}$/),
		title: z.string().min(1).max(512)
	})
	.strict()
const issuedSchema = z
	.object({
		authorization: z.string().min(1).max(49152),
		tenantGrant: z.string().min(1).max(49152)
	})
	.strict()
const receiptSchema = z
	.object({
		outcome: z.enum(['published', 'retained']),
		artifacts: z
			.array(
				z
					.object({
						artifactId: z.uuid(),
						artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
						type: z.string(),
						version: z.literal(1)
					})
					.strict()
			)
			.min(1)
			.max(2)
	})
	.strict()

/** One admitted execution. Transport authority never appears in Actor parameters,
 * wire output or a portable Skill. The host hands committed observations to the
 * generic Studio publisher as references, not newly asserted raw values. */
export class ConnectionRuntime {
	private readonly selected = new Map<string, AdmittedExecutionRecord>()
	private readonly outputs = new Map<string, Record<string, StudioArtifact[]>>()
	constructor(
		private readonly config: ConnectionRuntimeConfig,
		private readonly store: StudioArtifacts,
		private readonly admissions: AdmittedInvocations,
		private readonly reviews: ReviewStore,
		private readonly request: PlanRunStartRequest,
		private readonly context: PlanRunExecutionContext
	) {}

	host() {
		const guarded = this.admissions.host(this.request, this.context, async (record) => {
			const proposal = preparedSchema.parse(
				await this.policy('prepare', await this.selection(record))
			)
			await requestRunReview(this.reviews, this.context, {
				invocationId: record.invocationId,
				...proposal
			})
			this.selected.set(record.stepId, record)
		})
		return {
			invoke: (async (invocation, dispatch) => {
				if (!connectionCapabilities.has(invocation.payload.capabilityId)) return dispatch()
				try {
					return await guarded.invoke(invocation, dispatch)
				} finally {
					this.selected.delete(invocation.payload.stepId)
				}
			}) as typeof guarded.invoke
		}
	}
	async takeOutputs(stepId: string, capability: string) {
		if (!connectionCapabilities.has(capability)) return undefined
		const values = this.outputs.get(stepId)
		this.outputs.delete(stepId)
		if (!values) throw Error('CONNECTION_RESULT_UNAVAILABLE')
		return values
	}
	private async selection(record: AdmittedExecutionRecord) {
		const input = record.inputs.filter((input) => input.slot === 'request')
		if (input.length !== 1) throw Error('CONNECTION_REQUEST_REQUIRED')
		const binding = record.capabilityId.includes(':web.')
			? record.parameters.binding_ref
			: (await this.store.get(input[0]!.artifactId)).payload.bindingRef
		return {
			environmentId: record.environmentId,
			runId: record.runId,
			invocationId: record.invocationId,
			requestId: input[0]!.artifactId,
			bindingRef: z.uuid().parse(binding)
		}
	}
	private async policy(operation: 'prepare' | 'issue', body: unknown) {
		if (!this.context.session) throw Error('CONNECTION_SESSION_REQUIRED')
		return this.post(
			this.config.policyUrl,
			`/internal/v1/connections/${operation}`,
			this.config.policyToken,
			body,
			{ 'x-aven-identity-token': this.context.session.identityToken }
		)
	}
	private async post(
		base: string,
		path: string,
		token: string,
		body: unknown,
		headers: Record<string, string>
	) {
		const response = await fetch(new URL(path, base), {
			method: 'POST',
			redirect: 'manual',
			signal: AbortSignal.any([
				...(this.context.signal ? [this.context.signal] : []),
				AbortSignal.timeout(65000)
			]),
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		})
		if (![200, 201].includes(response.status)) {
			await response.body?.cancel()
			// Unknown outcome is never retried by this adapter. The durable proxy claim
			// and publication receipt determine whether a later resume can be safe.
			throw Error(
				response.status === 409
					? 'CONNECTION_CAPTURE_UNSETTLED'
					: 'CONNECTION_NOT_AUTHORIZED_OR_UNAVAILABLE'
			)
		}
		return JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBytes(response, 110 * 1024))
		)
	}
	factories() {
		return createConnectionFactories(
			this.store,
			(call) => this.capture(call),
			() => this.catalog()
		)
	}
	private async catalog() {
		if (!this.context.session) throw Error('CONNECTION_SESSION_REQUIRED')
		const response = await fetch(
			new URL(`/api/environments/${this.store.scope}/credentials`, this.config.metadataUrl),
			{
				headers: { authorization: `Bearer ${this.context.session.identityToken}` },
				redirect: 'manual',
				signal: AbortSignal.any([
					...(this.context.signal ? [this.context.signal] : []),
					AbortSignal.timeout(10000)
				])
			}
		)
		if (response.status !== 200) {
			await response.body?.cancel()
			throw Error('CONNECTION_METADATA_UNAVAILABLE')
		}
		const catalog = publicConnectionCatalog(
			JSON.parse(
				new TextDecoder('utf-8', { fatal: true }).decode(
					await readBoundedBytes(response, 1024 * 1024)
				)
			)
		)
		return {
			wire: `${catalog.bindings.length} saved destinations; metadata only, not permission to connect.`,
			record: JSON.stringify({ ok: true, outputs: { catalog } })
		}
	}
	private async capture(call: ActorStepPayload) {
		const record = this.selected.get(call.stepId)
		if (!record || record.capabilityId !== call.capabilityId || !this.context.session)
			throw Error('CONNECTION_INVOCATION_NOT_ADMITTED')
		const selection = await this.selection(record)
		const issued = issuedSchema.parse(
			await this.policy('issue', {
				selection,
				reviewId: stablePublicationUuid(`review:${record.runId}:${record.invocationId}`)
			})
		)
		const protocol = call.capabilityId.includes(':web.') ? 'http' : 'imap'
		const target = this.config[protocol]
		// Forward the admitted session's declared role, not a default. The executor
		// independently verifies its signature and exact equality with these headers.
		const identity = decodeJwt(this.context.session.identityToken)
		if (identity.sub !== record.subjectId || identity.sid !== record.sessionId)
			throw Error('CONNECTION_SESSION_CHANGED')
		const receipt = receiptSchema.parse(
			await this.post(
				target.url,
				'/internal/connection/execute',
				target.token,
				{ authorization: issued.authorization },
				{
					'x-aven-identity-token': this.context.session.identityToken,
					'x-aven-tenant-grant': issued.tenantGrant,
					'x-aven-subject': record.subjectId,
					'x-aven-role': z.enum(['user', 'admin']).parse(identity.role),
					'x-aven-session': record.sessionId
				}
			)
		)
		const types =
			protocol === 'http'
				? { response: 'web.http-response' }
				: call.capabilityId.endsWith(':imap_query@1')
					? { selection: 'mail.imap-query-result' }
					: { result: 'mail.imap-message-result', message: 'mail.message' }
		const output: Record<string, StudioArtifact[]> = Object.fromEntries(
			Object.keys(types).map((key) => [key, []])
		)
		for (const member of receipt.artifacts) {
			const name = Object.entries(types).find(([, type]) => member.type === type)?.[0]
			if (!name || output[name]!.length) throw Error('CONNECTION_RESULT_MISMATCH')
			const artifact = await this.store.get(member.artifactId)
			if (
				artifact.typeKey !== member.type ||
				artifact.typeVersion !== 1 ||
				artifact.artifactSha256 !== member.artifactDigest
			)
				throw Error('CONNECTION_RESULT_MISMATCH')
			const details = studioObject(
				await this.store.client.publication(this.store.scope, artifact.publicationId)
			)
			const publication = studioObject(details.publication),
				run = studioObject(details.run)
			if (
				publication.scopeId !== this.store.scope ||
				publication.runId !== artifact.producerRunId ||
				publication.publisher?.issuer !== this.config.publisher.issuer ||
				publication.publisher?.subject !== this.config.publisher.subject ||
				run.receipt?.invocationId !== record.invocationId ||
				run.receipt?.protocol !== protocol ||
				run.receipt?.bindingRef !== selection.bindingRef ||
				run.parameters?.requestOccurrenceId !== selection.requestId ||
				run.parameters?.requestArtifactDigest !==
					record.inputs.find((input) => input.slot === 'request')!.artifactDigest
			)
				throw Error('CONNECTION_PUBLICATION_MISMATCH')
			output[name]!.push(artifact)
		}
		this.outputs.set(call.stepId, output)
		return {
			record: JSON.stringify({ ok: true, outputs: {} }),
			wire: 'Reviewed observation saved.'
		}
	}
}

export function createConnectionFactories(
	store: StudioArtifacts,
	capture?: (call: ActorStepPayload) => Promise<{ record: string; wire: string }>,
	catalog?: () => Promise<{ record: string; wire: string }>
) {
	return [HTTP_CONNECTION_MANIFEST, IMAP_CONNECTION_MANIFEST, CONNECTION_CATALOG_MANIFEST].map(
		(manifest) =>
			installedFactory(manifest, store.scope, () => {
				const handlers = Object.fromEntries(
					manifest.methods.map((method) => [
						method.name,
						async (raw: unknown) => {
							const call = raw as ActorStepPayload
							if (manifest === CONNECTION_CATALOG_MANIFEST) {
								if (!catalog) throw Error('CONNECTION_SESSION_REQUIRED')
								return catalog()
							}
							if (connectionCapabilities.has(call.capabilityId)) {
								if (!capture) throw Error('CONNECTION_INVOCATION_NOT_ADMITTED')
								return capture(call)
							}
							return buildConnectionRequest(store, call)
						}
					])
				)
				const actor = new Actor(manifest, handlers)
				return { actor, dispose: () => actor.dispose() }
			})
	)
}

async function buildConnectionRequest(store: StudioArtifacts, call: ActorStepPayload) {
	const p = call.parameters
	let payload: unknown
	const references: Record<string, Array<{ role: string; id: string }>> = {}
	if (call.capabilityId.endsWith(':request@1'))
		payload = parseHttpRequestArtifact({
			url: p.url,
			method: p.method,
			authentication: { mode: 'mapped-required', purpose: p.purpose },
			freshness: 'new-capture',
			redirects: { mode: 'manual', maximumHops: 0 }
		})
	else {
		const members = call.inputMembers?.selection ?? []
		if (members.length > 1) throw Error('CONNECTION_SELECTION_INVALID')
		const selected = members.length ? await store.get(members[0]!.artifactId) : undefined
		if (selected && (selected.typeKey !== 'mail.imap-query-result' || selected.typeVersion !== 1))
			throw Error('CONNECTION_SELECTION_INVALID')
		const source = selected && {
			artifactId: selected.artifactId,
			artifactDigest: selected.artifactSha256
		}
		if (call.capabilityId.endsWith(':query_request@1')) {
			payload = imapQuerySchema.parse({
				bindingRef: p.binding_ref,
				mailbox: p.mailbox,
				purpose: p.purpose,
				criteria: {
					...(p.since || p.before ? { internalDate: { since: p.since, before: p.before } } : {}),
					fromContains: p.from,
					subjectContains: p.subject
				},
				...(source && { continuation: source })
			})
			if (selected) references['request-0'] = [{ role: 'continuation', id: selected.artifactId }]
		} else {
			if (!selected) throw Error('CONNECTION_SELECTION_REQUIRED')
			const value = imapQueryResultSchema.parse(selected.payload)
			if (!value.messages.some((message) => message.uid === p.uid && message.state === 'present'))
				throw Error('CONNECTION_MESSAGE_NOT_SELECTED')
			payload = imapReadSchema.parse({
				bindingRef: value.bindingRef,
				accountRef: value.accountRef,
				mailbox: value.mailbox,
				uidValidity: value.uidValidity,
				uid: p.uid,
				purpose: p.purpose,
				maximumBytes: p.maximum_bytes,
				selection: source
			})
			references['request-0'] = [{ role: 'selection', id: selected.artifactId }]
		}
	}
	return {
		record: JSON.stringify({ ok: true, outputs: { request: payload }, references }),
		wire: 'Request prepared; no external access yet.'
	}
}
