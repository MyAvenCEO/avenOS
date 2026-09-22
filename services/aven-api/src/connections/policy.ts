import { createHash, randomUUID } from 'node:crypto'
import type { ActorReviewRecord } from '@avenos/actors/review'
import {
	type ArtifactJson,
	canonicalArtifactJson,
	clientRunIdentity,
	type StoredArtifact
} from '@avenos/artifact-store'
import { credentialUseSigner } from '@avenos/credential-storage/authority'
import {
	bindingProfileSchema,
	CredentialStoreError,
	type CredentialUse,
	credentialMetadataSchema,
	credentialUseSchema
} from '@avenos/credential-storage/contracts'
import { httpRequestDigest, parseHttpRequestArtifact } from '@avenos/http-resources/contracts'
import { imapQuerySchema, imapReadSchema, queryDigest, readDigest } from '@avenos/mail'
import { z } from 'zod'

const uuid = z.uuid()
const version = z.number().int().positive()
const scopeSchema = z
	.object({
		environmentId: uuid,
		subjectId: uuid,
		sessionId: z.string().min(1),
		generation: version,
		expiresAt: z.iso.datetime({ offset: true })
	})
	.strict()
const executionSchema = z
	.object({
		runId: uuid,
		leaseOwnerId: uuid,
		invocationId: uuid,
		callerActorId: z.string().min(1).max(256),
		capabilityId: z.string().min(1).max(256),
		requestOccurrenceId: uuid,
		requestArtifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
		bindingRef: uuid,
		parentInvocationIds: z.array(uuid).max(16),
		mode: z.literal('productive'),
		publicationScopeId: uuid,
		expiresAt: z.iso.datetime({ offset: true })
	})
	.strict()
const bindingSchema = z
	.object({
		bindingRef: uuid,
		credentialRef: uuid,
		revision: version,
		enabled: z.literal(true),
		protocol: z.enum(['http', 'imap']),
		profile: z.unknown()
	})
	.strict()
export type ConnectionPolicyScope = z.infer<typeof scopeSchema>
export type ConnectionExecution = z.infer<typeof executionSchema>
export interface ConnectionSelection {
	environmentId: string
	runId: string
	invocationId: string
	requestId: string
	bindingRef: string
}
export interface ConnectionPolicyPorts {
	/** Verify the live identity and entitlement, not caller-asserted principal data.
	 * Expiry must be bounded by both signed identity and fresh customer grant. */
	scope(identityToken: string, environmentId: string): Promise<ConnectionPolicyScope>
	/** Load the exact admitted invocation and active parent lease from the runner.
	 * Never construct this from request parameters or the model's proposed caller. */
	execution(
		scope: ConnectionPolicyScope,
		selection: ConnectionSelection
	): Promise<ConnectionExecution>
	request(scope: ConnectionPolicyScope, artifactId: string): Promise<StoredArtifact>
	metadata(scope: ConnectionPolicyScope): Promise<{ credentials: unknown[]; bindings: unknown[] }>
	review(scope: ConnectionPolicyScope, runId: string, reviewId: string): Promise<ActorReviewRecord>
}
export interface ConnectionPolicyConfig {
	revision: number
	/** Operator-admitted providers whose raw responses may be retained after review.
	 * Binding availability alone is not a response-release policy. */
	httpTargets: ReadonlyArray<{ origin: string; pathPrefix: string }>
	imapOrigins: readonly string[]
	maximumBytes: number
	maximumSeconds: number
}
export const connectionSubjectDigest = (subject: Record<string, unknown>) =>
	createHash('sha256')
		.update(canonicalArtifactJson(subject as ArtifactJson))
		.digest('hex')
const denied = () => new CredentialStoreError('CONNECTION_POLICY_DENIED')

/** Application policy only: no secret, SQL-use role, decryption or network exchange.
 * The private workload ingress and production adapters must be configured separately. */
export class ConnectionPolicy {
	private readonly sign: ReturnType<typeof credentialUseSigner>
	private readonly config: ConnectionPolicyConfig
	constructor(
		issuer: string,
		signingKey: CryptoKey,
		config: ConnectionPolicyConfig,
		private readonly ports: ConnectionPolicyPorts
	) {
		this.sign = credentialUseSigner(issuer, signingKey)
		if (
			!Number.isSafeInteger(config.revision) ||
			config.revision < 1 ||
			!Number.isSafeInteger(config.maximumBytes) ||
			config.maximumBytes < 1 ||
			config.maximumBytes > 32 * 1024 * 1024 ||
			!Number.isSafeInteger(config.maximumSeconds) ||
			config.maximumSeconds < 1 ||
			config.maximumSeconds > 60
		)
			throw denied()
		for (const origin of [
			...config.httpTargets.map((target) => target.origin),
			...config.imapOrigins
		])
			if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw denied()
		for (const target of config.httpTargets)
			if (
				!target.pathPrefix.startsWith('/') ||
				new URL(target.pathPrefix, target.origin).origin !== target.origin ||
				new URL(target.pathPrefix, target.origin).pathname !== target.pathPrefix ||
				/[?#]/.test(target.pathPrefix)
			)
				throw denied()
		this.config = Object.freeze({
			...config,
			httpTargets: Object.freeze(config.httpTargets.map((target) => Object.freeze({ ...target }))),
			imapOrigins: Object.freeze([...config.imapOrigins])
		})
	}

	/** Rebuild every review-relevant field from current owned records. No use is issued. */
	async prepare(identityToken: string, input: ConnectionSelection) {
		const selection = z
			.object({
				environmentId: uuid,
				runId: uuid,
				invocationId: uuid,
				requestId: uuid,
				bindingRef: uuid
			})
			.strict()
			.parse(input)
		const scope = scopeSchema.parse(await this.ports.scope(identityToken, selection.environmentId))
		if (
			scope.environmentId !== selection.environmentId ||
			Date.parse(scope.expiresAt) <= Date.now()
		)
			throw denied()
		const execution = executionSchema.parse(await this.ports.execution(scope, selection))
		if (
			execution.runId !== selection.runId ||
			execution.invocationId !== selection.invocationId ||
			execution.requestOccurrenceId !== selection.requestId ||
			execution.bindingRef !== selection.bindingRef ||
			execution.publicationScopeId !== scope.environmentId ||
			Date.parse(execution.expiresAt) <= Date.now()
		)
			throw denied()
		const [artifact, metadata] = await Promise.all([
			this.ports.request(scope, selection.requestId),
			this.ports.metadata(scope)
		])
		if (
			artifact.scopeId !== scope.environmentId ||
			artifact.artifactId !== selection.requestId ||
			artifact.artifactSha256 !== execution.requestArtifactDigest ||
			artifact.typeVersion !== 1 ||
			!/^[a-f0-9]{64}$/.test(artifact.artifactSha256)
		)
			throw denied()
		const candidates = metadata.bindings.filter(
			(value) =>
				value &&
				typeof value === 'object' &&
				'bindingRef' in value &&
				value.bindingRef === selection.bindingRef
		)
		if (candidates.length !== 1) throw denied()
		const binding = bindingSchema.parse(candidates[0]),
			typed = bindingProfileSchema.parse({ protocol: binding.protocol, profile: binding.profile })
		const credentials = metadata.credentials
			.map((value) => credentialMetadataSchema.parse(value))
			.filter((value) => value.credentialRef === binding.credentialRef)
		if (credentials.length !== 1 || !credentials[0]!.enabled) throw denied()
		const credential = credentials[0]!
		let request: Record<string, unknown>,
			schema: string,
			capability: string,
			operationDigest: string,
			title: string
		let maximumUnits = 1,
			maximumBytes = this.config.maximumBytes,
			maximumSeconds = this.config.maximumSeconds
		if (typed.protocol === 'http') {
			if (artifact.typeKey !== 'web.http-request') throw denied()
			const value = parseHttpRequestArtifact(artifact.payload),
				target = new URL(value.url),
				profile = typed.profile
			const hostMatches =
				profile.host.kind === 'exact'
					? target.hostname === profile.host.value
					: target.hostname.endsWith(`.${profile.host.value}`)
			const pathMatches =
				profile.pathPrefix === '/' ||
				target.pathname === profile.pathPrefix ||
				target.pathname.startsWith(
					profile.pathPrefix.endsWith('/') ? profile.pathPrefix : `${profile.pathPrefix}/`
				)
			// This first production slice makes exactly one new observation, not a cache
			// refresh, anonymous fallback, redirect chain or retry that was not reviewed.
			const releaseAllowed = this.config.httpTargets.some(
				(allowed) =>
					allowed.origin === target.origin &&
					(allowed.pathPrefix === '/' ||
						target.pathname === allowed.pathPrefix ||
						target.pathname.startsWith(
							allowed.pathPrefix.endsWith('/') ? allowed.pathPrefix : `${allowed.pathPrefix}/`
						))
			)
			if (
				!releaseAllowed ||
				!hostMatches ||
				!pathMatches ||
				!profile.methods.includes(value.method) ||
				!profile.ports.includes(Number(target.port || 443)) ||
				value.authentication.mode !== 'mapped-required' ||
				value.authentication.purpose !== profile.purpose ||
				value.freshness !== 'new-capture' ||
				value.redirects.mode !== 'manual' ||
				value.redirects.maximumHops !== 0
			)
				throw denied()
			request = { ...value }
			schema = 'ceo.aven:schema:web:http-request@1'
			capability = 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1'
			operationDigest = httpRequestDigest(value)
			title = `Read ${target.hostname.slice(0, 220)}?`
		} else {
			const profile = typed.profile,
				query = artifact.typeKey === 'mail.imap-query'
			if (
				(!query && artifact.typeKey !== 'mail.imap-message-request') ||
				credential.kind !== 'password'
			)
				throw denied()
			const value = query
				? imapQuerySchema.parse(artifact.payload)
				: imapReadSchema.parse(artifact.payload)
			if (
				!this.config.imapOrigins.includes(
					new URL(`https://${profile.host}:${profile.port}`).origin
				) ||
				value.bindingRef !== binding.bindingRef ||
				value.purpose !== profile.purpose ||
				!profile.mailboxes.includes(value.mailbox) ||
				!profile.operations.includes(query ? 'query' : 'read-message') ||
				('accountRef' in value && value.accountRef !== profile.accountRef)
			)
				throw denied()
			maximumUnits = Math.min(
				profile.maximumCommands,
				'limits' in value ? value.limits.maximumCommands : 16
			)
			maximumBytes = Math.min(
				maximumBytes,
				profile.maximumBytes,
				'limits' in value ? value.limits.maximumResultBytes : value.maximumBytes
			)
			maximumSeconds = Math.min(
				maximumSeconds,
				profile.maximumSeconds,
				'limits' in value ? value.limits.maximumSeconds : 60
			)
			request = { ...value }
			schema = `ceo.aven:schema:mail:imap-${query ? 'query' : 'message-request'}@1`
			capability = `ceo.aven:capability:mail.imap-mailbox:imap_${query ? 'query' : 'read_message'}@1`
			operationDigest = query ? queryDigest(value) : readDigest(value)
			title = query
				? `Search ${profile.label.slice(0, 220)}?`
				: `Read one message from ${profile.label.slice(0, 220)}?`
		}
		if (execution.capabilityId !== capability) throw denied()
		const subject = {
			protocol: typed.protocol,
			runId: execution.runId,
			invocationId: execution.invocationId,
			callerActorId: execution.callerActorId,
			parentInvocationIds: execution.parentInvocationIds,
			environmentId: scope.environmentId,
			subjectId: scope.subjectId,
			generation: scope.generation,
			mode: execution.mode,
			publicationScopeId: execution.publicationScopeId,
			requestOccurrenceId: artifact.artifactId,
			requestArtifactDigest: artifact.artifactSha256,
			requestSchemaId: schema,
			operationDigest,
			capabilityId: capability,
			request,
			bindingRef: binding.bindingRef,
			bindingRevision: binding.revision,
			credentialRef: credential.credentialRef,
			credentialLabel: credential.label,
			secretVersion: credential.secretVersion,
			connection: typed,
			purpose: typed.profile.purpose,
			policyRevision: this.config.revision,
			limits: {
				maximumUnits,
				maximumBytes,
				maximumSeconds,
				maximumAttempts: 1,
				followRedirects: false
			},
			responsePolicy: 'reviewed-provider-raw-v1'
		}
		return {
			scope,
			execution,
			subject,
			subjectDigest: connectionSubjectDigest(subject),
			title,
			subjectSchema:
				typed.protocol === 'http'
					? 'ceo.aven:schema:web:http-credential-use-review@1'
					: 'ceo.aven:schema:mail:imap-credential-use-review@1'
		}
	}

	private async approved(identityToken: string, selection: ConnectionSelection, reviewId: string) {
		const proposal = await this.prepare(identityToken, selection)
		const review = await this.ports.review(proposal.scope, selection.runId, uuid.parse(reviewId))
		const { subject, scope, execution } = proposal
		if (
			review.id !== reviewId ||
			review.runId !== execution.runId ||
			review.invocationId !== execution.invocationId ||
			review.generation !== scope.generation ||
			review.superseded ||
			review.subjectSchema !== proposal.subjectSchema ||
			review.subjectDigest !== proposal.subjectDigest ||
			connectionSubjectDigest(review.subject) !== proposal.subjectDigest ||
			!review.decision ||
			review.decision.outcome !== 'approve' ||
			review.decision.reviewerId !== scope.subjectId
		)
			throw denied()
		if (
			!Number.isFinite(Date.parse(review.expiresAt)) ||
			Date.parse(review.expiresAt) <= Date.now()
		)
			throw denied()
		return { ...proposal, review, decisionId: review.decision.id }
	}

	/** Re-read current entitlement, admitted invocation, metadata and exact human
	 * decision. A valid signature alone never proves the operation is still allowed. */
	async assertCurrent(identityToken: string, raw: CredentialUse) {
		const use = credentialUseSchema.parse(raw)
		const current = await this.approved(
			identityToken,
			{
				environmentId: use.environmentId,
				runId: use.runId,
				invocationId: use.invocationId,
				requestId: use.requestOccurrenceId,
				bindingRef: use.bindingRef
			},
			use.reviewRequestId
		)
		const { scope, execution, subject, review } = current
		const expected = {
			environmentId: scope.environmentId,
			subjectId: scope.subjectId,
			sessionId: scope.sessionId,
			generation: scope.generation,
			runId: execution.runId,
			leaseOwnerId: execution.leaseOwnerId,
			invocationId: execution.invocationId,
			callerActorId: execution.callerActorId,
			parentInvocationIds: execution.parentInvocationIds,
			protocol: subject.protocol,
			capabilityId: subject.capabilityId,
			bindingRef: subject.bindingRef,
			bindingRevision: subject.bindingRevision,
			credentialRef: subject.credentialRef,
			secretVersion: subject.secretVersion,
			requestOccurrenceId: subject.requestOccurrenceId,
			requestArtifactDigest: subject.requestArtifactDigest,
			requestSchemaId: subject.requestSchemaId,
			operationDigest: subject.operationDigest,
			purpose: subject.purpose,
			policyRevision: subject.policyRevision,
			reviewRequestId: review.id,
			reviewDecisionId: current.decisionId,
			mode: subject.mode,
			publicationScopeId: subject.publicationScopeId,
			maximumUnits: subject.limits.maximumUnits,
			maximumBytes: subject.limits.maximumBytes,
			attemptId: await clientRunIdentity(
				`connection-attempt:${scope.environmentId}:${execution.runId}:${execution.invocationId}:0`
			)
		}
		for (const [key, value] of Object.entries(expected))
			if (JSON.stringify(use[key as keyof CredentialUse]) !== JSON.stringify(value)) throw denied()
		const expiry = Date.parse(use.expiresAt)
		if (
			expiry <= Date.now() ||
			Date.parse(use.issuedAt) > Date.now() + 1000 ||
			expiry - Date.parse(use.issuedAt) > subject.limits.maximumSeconds * 1000 ||
			expiry >
				Math.min(
					Date.parse(scope.expiresAt),
					Date.parse(execution.expiresAt),
					Date.parse(review.expiresAt)
				)
		)
			throw denied()
	}

	async issue(
		identityToken: string,
		selection: ConnectionSelection,
		reviewId: string
	): Promise<{ token: string; use: CredentialUse }> {
		const { subject, scope, execution, review, decisionId } = await this.approved(
			identityToken,
			selection,
			reviewId
		)
		const now = Date.now(),
			expires = Math.min(
				now + subject.limits.maximumSeconds * 1000,
				Date.parse(scope.expiresAt),
				Date.parse(execution.expiresAt),
				Date.parse(review.expiresAt)
			)
		if (!Number.isFinite(expires) || expires <= now + 1000) throw denied()
		const use = credentialUseSchema.parse({
			authorizationId: randomUUID(),
			environmentId: scope.environmentId,
			subjectId: scope.subjectId,
			sessionId: scope.sessionId,
			generation: scope.generation,
			runId: execution.runId,
			leaseOwnerId: execution.leaseOwnerId,
			invocationId: execution.invocationId,
			// One logical operation has one protocol attempt even after reauthentication
			// or runner restart. The SQL uniqueness constraint prevents a second capture.
			attemptId: await clientRunIdentity(
				`connection-attempt:${scope.environmentId}:${execution.runId}:${execution.invocationId}:0`
			),
			callerActorId: execution.callerActorId,
			parentInvocationIds: execution.parentInvocationIds,
			protocol: subject.protocol,
			capabilityId: subject.capabilityId,
			bindingRef: subject.bindingRef,
			bindingRevision: subject.bindingRevision,
			credentialRef: subject.credentialRef,
			secretVersion: subject.secretVersion,
			requestOccurrenceId: subject.requestOccurrenceId,
			requestArtifactDigest: subject.requestArtifactDigest,
			requestSchemaId: subject.requestSchemaId,
			operationDigest: subject.operationDigest,
			purpose: subject.purpose,
			policyRevision: subject.policyRevision,
			reviewRequestId: review.id,
			reviewDecisionId: decisionId,
			mode: subject.mode,
			publicationScopeId: subject.publicationScopeId,
			maximumUnits: subject.limits.maximumUnits,
			maximumBytes: subject.limits.maximumBytes,
			issuedAt: new Date(now).toISOString(),
			expiresAt: new Date(expires).toISOString()
		})
		return { token: await this.sign(use), use }
	}
}
