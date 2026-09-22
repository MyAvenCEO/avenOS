import {
	ACTOR_RUN_PROTOCOL,
	type ActorAuthorizer,
	type ActorRegistrySnapshot,
	composeCatalogOperation,
	composeSkillArtifact,
	newStudioSkillV2,
	type PlanRunExecutionContext,
	type PlanRunner,
	type PlanRunSecurityContext,
	parseStudioSkillParameters,
	parseStudioSkillV2,
	presentSkillArtifact,
	STUDIO_SKILL_ARTIFACT_VERSION,
	StudioCatalog,
	type StudioSkillV2,
	studioSkillChildReferences,
	type TrustedActorInstallation,
	type TrustedActorInstallations
} from '@avenos/actors'
import { isStudioReadOperation } from '@avenos/actors/studio/operations'
import type pg from 'pg'
import { z } from 'zod'
import {
	type StudioArtifacts,
	studioIdentity,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'
import { StudioCases } from './studio-cases.js'
import { explorationDirections, exploreCatalog } from './studio-exploration.js'
import { StudioV2Authoring } from './studio-v2-authoring.js'
import {
	StudioV2DraftConflict,
	type StudioV2DraftStore,
	StudioV2Drafts
} from './studio-v2-drafts.js'
import { STUDIO_SKILL_V2 } from './studio-v2-executor.js'
import { StudioV2SkillPublisher } from './studio-v2-publisher.js'

const uuid = z.uuid()
const inputBindings = z.record(
	z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
	z.union([uuid, z.array(uuid).max(256), z.null()])
)
const commandSchema = z
	.object({
		operation: z.enum([
			'case-propose',
			'case-confirm',
			'case-what-if',
			'case-build',
			'catalog',
			'present',
			'state',
			'items',
			'inspect',
			'explore',
			'preview',
			'compare',
			'draft',
			'publish',
			'start',
			'sample',
			'connect',
			'control',
			'sync',
			'run-control',
			'run-status'
		]),
		data: z.record(z.string(), z.unknown()).default({})
	})
	.strict()
export class StudioConflict extends Error {}
/** Validation rejected this command before publishing an activation or subscription. */
export class StudioAdmissionRejected extends StudioConflict {}

export interface StudioCatalogSource {
	registry(): ActorRegistrySnapshot | Promise<ActorRegistrySnapshot>
	authorizer(security: PlanRunSecurityContext): ActorAuthorizer | Promise<ActorAuthorizer>
	runtimeSupports?(actorId: string, capabilityId: string): boolean
	installationFor?(actorId: string): TrustedActorInstallation | undefined
}

export class StudioService {
	readonly catalog = new StudioCatalog()
	readonly authoring?: StudioV2Authoring
	constructor(
		readonly database: pg.Pool,
		readonly artifacts: StudioArtifacts,
		readonly runner: PlanRunner,
		readonly catalogSource?: StudioCatalogSource,
		installations?: TrustedActorInstallations,
		drafts: StudioV2DraftStore = new StudioV2Drafts(database)
	) {
		if (installations && catalogSource) {
			const publisher = new StudioV2SkillPublisher(artifacts, installations)
			this.authoring = new StudioV2Authoring(drafts, publisher, async (security) => ({
				principal: security.principal,
				access: security.access,
				actorAuthorizer: await catalogSource.authorizer(security),
				resolveReadableSkill: (artifactId) => artifacts.get(artifactId),
				assertCanPublish: async () => {}
			}))
		}
	}
	async call(
		raw: unknown,
		security: PlanRunSecurityContext,
		context: PlanRunExecutionContext,
		readOnly: boolean
	) {
		const { operation, data } = commandSchema.parse(raw)
		if (readOnly && !isStudioReadOperation(operation))
			throw new StudioConflict('This operation requires write access.')
		const subject = security.principal.subjectId
		switch (operation) {
			case 'case-propose': {
				const d = z
					.object({ case: z.unknown(), predecessorArtifactId: uuid.optional() })
					.strict()
					.parse(data)
				return new StudioCases(this.artifacts).propose(d.case, subject, d.predecessorArtifactId)
			}
			case 'case-confirm': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				return new StudioCases(this.artifacts).confirm(d.artifactId, subject)
			}
			case 'case-what-if': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				return new StudioCases(this.artifacts).whatIf(d.artifactId)
			}
			case 'case-build': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				const { record } = await new StudioCases(this.artifacts).read(d.artifactId)
				if (record.status !== 'confirmed')
					throw new StudioConflict('Confirm this case before building a Skill.')
				if (!record.case.steps.length || record.case.steps.some((s) => s.kind === 'ideal'))
					throw new StudioConflict(
						'Resolve the missing steps first. You can explore What if without running anything.'
					)
				if (!this.authoring) throw new StudioConflict('STUDIO_AUTHORING_UNCONFIGURED')
				const id = await studioIdentity(this.artifacts.scope, subject, 'case-skill', d.artifactId)
				// Reopening a case resumes its draft, including edits made after the initial build.
				try {
					return await this.authoring.get(id, security)
				} catch (error) {
					if (!(error instanceof StudioV2DraftConflict) || error.message !== 'DRAFT_UNAVAILABLE')
						throw error
				}
				let definition = newStudioSkillV2(record.case.title)
				definition.caseArtifactId = d.artifactId
				for (const step of record.case.steps) {
					const previous = definition.steps.at(-1)?.id
					if (step.kind === 'skill') {
						const child = await this.artifacts.get(step.artifactId)
						if (
							child.typeKey !== 'studio.skill' ||
							child.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION
						)
							throw Error('Select an executable Skill.')
						definition = composeSkillArtifact(
							definition,
							child.artifactId,
							child.payload
						).definition
					} else if (step.kind === 'action') {
						const page = (await this.call(
							{ operation: 'catalog', data: { search: step.capabilityId, limit: 100 } },
							security,
							context,
							true
						)) as { entries: import('@avenos/actors').StudioCatalogEntry[] }
						const entry = page.entries.find((e) => e.capabilityId === step.capabilityId)
						if (!entry?.canAuthor)
							throw Error(
								`Action is not available: ${step.label}. Revise the case or describe a missing step.`
							)
						definition = composeCatalogOperation(definition, entry).definition
					}
					const authored = definition.steps.at(-1)
					if (authored) {
						authored.label = step.label
						if (previous) authored.after = [...new Set([...(authored.after ?? []), previous])]
					}
				}
				return this.authoring.save({ id, revision: 0, definition }, security)
			}
			case 'catalog': {
				const d = z
					.object({
						search: z.string().max(256).optional(),
						readyOnly: z.boolean().optional(),
						limit: z.number().int().min(1).max(100).optional(),
						cursor: z.string().max(32).optional(),
						viewToken: z.uuid().optional()
					})
					.strict()
					.parse(data)
				if (!this.catalogSource) throw new StudioConflict('ACTOR_CATALOG_UNCONFIGURED')
				const [registry, authorizer] = await Promise.all([
					this.catalogSource.registry(),
					this.catalogSource.authorizer(security)
				])
				return this.catalog.page({
					registry,
					authorizer,
					principal: security.principal,
					access: security.access,
					runtimeSupports: this.catalogSource.runtimeSupports,
					installationFor: this.catalogSource.installationFor,
					...d
				})
			}
			case 'present': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				const artifact = await this.artifacts.get(d.artifactId)
				if (artifact.typeKey !== 'studio.skill')
					throw new StudioConflict('The selected artifact is not a Skill.')
				return presentSkillArtifact(
					artifact.artifactId,
					artifact.artifactSha256,
					artifact.typeVersion,
					artifact.payload
				)
			}
			case 'items': {
				const query = z
					.object({
						typeKey: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
						snapshotSequence: z.number().int().nonnegative().optional(),
						after: uuid.optional(),
						limit: z.number().int().min(1).max(128).optional()
					})
					.strict()
					.parse(data)
				return this.artifacts.client.queryArtifacts(this.artifacts.scope, query)
			}
			case 'state':
				z.object({}).strict().parse(data)
				return this.state(security)
			case 'inspect': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				const artifact = await this.artifacts.get(d.artifactId)
				return {
					artifact,
					evidence: studioObject(
						await this.artifacts.client.supportingEvidence(this.artifacts.scope, d.artifactId)
					).evidence,
					inputs: studioObject(
						await this.artifacts.client.producerInputs(this.artifacts.scope, d.artifactId)
					).inputs,
					production: await this.artifacts.client.publication(
						this.artifacts.scope,
						artifact.publicationId
					)
				}
			}
			case 'explore': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				const source = await this.artifacts.get(d.artifactId)
				if (!this.catalogSource) throw new StudioConflict('ACTOR_CATALOG_UNCONFIGURED')
				const [registry, authorizer] = await Promise.all([
					this.catalogSource.registry(),
					this.catalogSource.authorizer(security)
				])
				const request = {
					registry,
					authorizer,
					principal: security.principal,
					access: security.access,
					runtimeSupports: this.catalogSource.runtimeSupports,
					installationFor: this.catalogSource.installationFor,
					limit: 100
				}
				let page = await this.catalog.page(request)
				const entries = [...page.entries]
				while (page.nextCursor) {
					page = await this.catalog.page({
						...request,
						cursor: page.nextCursor,
						viewToken: page.viewToken
					})
					entries.push(...page.entries)
				}
				const opportunities = exploreCatalog(source, entries)
				return {
					source,
					opportunities,
					directions: explorationDirections(source),
					coverage: {
						catalog: page.catalogDigest,
						installedCapabilities: page.totalVisibleCount,
						relatedArtifacts: false
					},
					next: opportunities.length
						? 'Choose an outcome.'
						: 'No installed Skill consumes this type yet. You can still inspect its evidence.'
				}
			}
			case 'preview': {
				const d = z.object({ definition: z.unknown() }).strict().parse(data)
				return this.preview(d.definition, security)
			}
			case 'compare': {
				const d = z
					.object({ baseline: z.unknown(), variants: z.array(z.unknown()).max(4) })
					.strict()
					.parse(data)
				return {
					mode: 'planning-only',
					baseline: await this.preview(d.baseline, security),
					variants: await Promise.all(d.variants.map((v) => this.preview(v, security)))
				}
			}
			case 'draft': {
				const d = z
					.object({
						id: uuid,
						revision: z.number().int().nonnegative(),
						definition: z.unknown(),
						originArtifactId: uuid.optional()
					})
					.strict()
					.parse(data)
				if (!this.authoring) throw new StudioConflict('STUDIO_AUTHORING_UNCONFIGURED')
				return this.authoring.save(d, security)
			}
			case 'publish': {
				const d = z.object({ id: uuid, revision: z.number().int().positive() }).strict().parse(data)
				if (!this.authoring) throw new StudioConflict('STUDIO_AUTHORING_UNCONFIGURED')
				return this.authoring.publish(d.id, d.revision, security)
			}
			case 'start': {
				const d = z
					.object({
						requestId: uuid,
						skillArtifactId: uuid,
						inputs: inputBindings,
						parameters: z.record(z.string(), z.unknown()).default({})
					})
					.strict()
					.parse(data)
				return this.start(d, security, context)
			}
			case 'sample': {
				const d = z.object({ requestId: uuid, observedAt: z.iso.datetime() }).strict().parse(data)
				const sourceId = await studioIdentity(this.artifacts.scope, subject, 'sample-source')
				const [source] = await this.artifacts.publish({
					id: sourceId,
					procedure: 'studio.source',
					principal: subject,
					inputs: [],
					parameters: {},
					artifacts: [
						{
							key: 'source',
							type: 'studio.source',
							payload: {
								sourceId,
								name: 'Sample mailbox',
								kind: 'synthetic-email',
								contractVersion: 1
							}
						}
					]
				})
				const content =
					'Project update\n\nThe design review is scheduled for Thursday. Bring the proposed scope and outstanding questions.\n'
				const rawEmail = `From: sample@example.test\r\nTo: studio@example.test\r\nSubject: Project update\r\nMessage-ID: <${d.requestId}@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="studio-sample"\r\n\r\n--studio-sample\r\nContent-Type: text/plain\r\n\r\nPlease see the attachment.\r\n--studio-sample\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="project-update.txt"\r\n\r\n${content}\r\n--studio-sample--\r\n`
				const captured = await this.artifacts.publish({
					id: await studioIdentity(this.artifacts.scope, subject, 'capture', d.requestId),
					procedure: 'studio.capture',
					principal: subject,
					inputs: [{ role: 'source', id: source!.artifactId }],
					parameters: { occurrenceId: d.requestId },
					artifacts: [
						{
							key: 'attachment',
							type: 'core.file',
							payload: {
								originalName: 'project-update.txt',
								declaredMediaType: 'text/plain',
								sourceKind: 'studio-synthetic-email',
								executionEnvironment: 'server'
							},
							bytes: new TextEncoder().encode(content)
						},
						{
							key: 'email',
							type: 'studio.email',
							payload: {
								sourceArtifactId: source!.artifactId,
								occurrenceId: d.requestId,
								subject: 'Project update',
								from: 'sample@example.test',
								receivedAt: d.observedAt
							},
							bytes: new TextEncoder().encode(rawEmail),
							references: [{ role: 'attachment', local: 'attachment' }]
						}
					]
				})
				await this.sync(security, context)
				return { source, artifacts: captured }
			}
			case 'connect':
				return this.connect(data, subject)
			case 'run-control': {
				const d = z
					.object({ runId: uuid, requestId: uuid, action: z.enum(['retry', 'cancel']) })
					.strict()
					.parse(data)
				const run = await this.runner.status(d.runId)
				if (
					!run ||
					run.security.principal.subjectId !== subject ||
					run.skillRef !== STUDIO_SKILL_V2
				)
					throw new StudioConflict('This Studio run is unavailable.')
				if (d.action === 'cancel') return this.runner.cancel(d.runId, d.requestId)
				if (!this.runner.retry) throw new StudioConflict('Retry is not supported by this host.')
				return this.runner.retry(d.runId, d.requestId, context)
			}
			case 'run-status': {
				const d = z
					.object({ runId: uuid, waitMs: z.number().int().min(0).max(30000).default(0) })
					.strict()
					.parse(data)
				const deadline = Date.now() + d.waitMs
				for (;;) {
					const run = await this.runner.status(d.runId)
					if (
						!run ||
						run.security.principal.subjectId !== subject ||
						run.skillRef !== STUDIO_SKILL_V2
					)
						throw new StudioConflict('This Studio run is unavailable.')
					const pending = ['accepted', 'planning', 'running'].includes(run.state)
					if (!pending || Date.now() >= deadline) {
						const checkpoint = run.checkpoints.at(-1)
						return {
							runId: run.runId,
							state: run.state,
							runRevision: run.revision,
							activationArtifactId: run.parameters.activationArtifactId,
							updatedAt: run.updatedAt,
							outputs: checkpoint?.output ?? null,
							completedStepIds: checkpoint?.completedStepIds ?? [],
							continuations: run.continuations,
							failure: run.failure ?? null,
							progress: run.progress ?? null,
							next: pending
								? 'Still running. Tell the user it is underway; do not search artifact snapshots for results. Inspect this run again when needed.'
								: run.state === 'failed'
									? 'Inspect the failure and any committed outputs. Explain the correction and obtain permission before retrying this same run; do not start a duplicate activation.'
									: run.state === 'cancelled'
										? 'Cancellation is terminal. Inspect any committed outputs before proposing new work. An accumulating connection blocked by this run needs a separately authorized replacement connection; resuming it cannot undo cancellation.'
										: run.state === 'waiting_for_input'
											? 'Inspect the required continuation and explain what the user must provide. Do not report completion or start a duplicate run.'
											: 'Read exact output artifact IDs to inspect the result. A saved output does not independently verify its content.'
						}
					}
					await new Promise((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now())))
				}
			}
			case 'control': {
				const d = z
					.object({ id: uuid, revision: z.number().int().positive(), enabled: z.boolean() })
					.strict()
					.parse(data)
				return withStudioLock(this.database, subject, async (connection) => {
					const row = (
						await connection.query(
							'SELECT * FROM studio_connections WHERE id=$1 AND subject_id=$2',
							[d.id, subject]
						)
					).rows[0]
					if (!row || row.revision !== d.revision)
						throw new StudioConflict('The connection changed. Refresh before continuing.')
					const point =
						d.enabled && !row.activated_at
							? await this.artifacts.highWater()
							: { epoch: row.store_epoch, sequence: row.after_sequence }
					const updated = await connection.query(
						'UPDATE studio_connections SET enabled=$1,revision=revision+1,updated_at=clock_timestamp(),store_epoch=$5,after_sequence=$6,activated_at=CASE WHEN $1 THEN coalesce(activated_at,clock_timestamp()) ELSE activated_at END WHERE id=$2 AND subject_id=$3 AND revision=$4 RETURNING *',
						[d.enabled, d.id, subject, d.revision, point.epoch, point.sequence]
					)
					if (!updated.rowCount)
						throw new StudioConflict('The connection changed. Refresh before continuing.')
					return {
						...updated.rows[0],
						notice: !d.enabled
							? 'Paused new admissions and retained the arrival cursor. Already admitted runs may finish. Matching arrivals remain available for catch-up when this connection resumes; no historical backfill is added.'
							: !row.activated_at
								? 'Enabled from the current arrival boundary. Authenticated-session synchronization will admit matching new arrivals, not historical backfill.'
								: 'Resumed from the retained arrival cursor. Authenticated-session synchronization will consider matching arrivals received while paused. This receipt does not mean their runs have completed; inspect synchronization and run status.'
					}
				})
			}
			case 'sync':
				z.object({}).strict().parse(data)
				return this.sync(security, context)
		}
	}
	async state(security: PlanRunSecurityContext) {
		const subject = security.principal.subjectId
		const [drafts, connections, runs, files, skills, sources, all, deliveries] = await Promise.all([
			this.database.query(
				'SELECT * FROM studio_drafts WHERE subject_id=$1 ORDER BY updated_at DESC LIMIT 256',
				[subject]
			),
			this.database.query(
				`SELECT c.*, (
				 SELECT jsonb_build_object('runId',d.run_id,'state',r.state)
				 FROM studio_deliveries d JOIN runs r ON r.id=d.run_id
				 WHERE d.connection_id=c.id AND d.subject_id=$1 AND r.subject_id=$1
				 AND c.record->'collection'->>'mode'='accumulate'
				 AND r.state IN ('failed','cancelled','waiting_for_input')
				 ORDER BY (d.record->>'sequence')::bigint,(d.record->>'ordinal')::int LIMIT 1
				) AS blocked_run
				 FROM studio_connections c WHERE c.subject_id=$1 ORDER BY c.updated_at DESC LIMIT 64`,
				[subject]
			),
			this.database.query(
				"SELECT record FROM runs WHERE subject_id=$1 AND record->>'skillRef'=$2 ORDER BY updated_at DESC LIMIT 32",
				[subject, STUDIO_SKILL_V2]
			),
			this.artifacts.list('core.file'),
			this.artifacts.list('studio.skill'),
			this.artifacts.list('studio.source'),
			Promise.all(
				['studio.email', 'studio.understanding', 'studio.brief', 'studio.case'].map((type) =>
					this.artifacts.list(type)
				)
			),
			this.database.query(
				'SELECT id,run_id,last_error,record,connection_id,created_at FROM studio_deliveries WHERE subject_id=$1 AND run_id IS NULL ORDER BY created_at LIMIT 256',
				[subject]
			)
		])
		return {
			scopeId: this.artifacts.scope,
			subjectId: subject,
			drafts: this.authoring ? await this.authoring.list(security) : drafts.rows,
			connections: connections.rows,
			runs: runs.rows.map((r) => r.record),
			files: files.items ?? [],
			skills: skills.items ?? [],
			sources: sources.items ?? [],
			artifacts: [files, skills, sources, ...all]
				.flatMap((page) => page.items ?? [])
				.sort((a, b) => b.scopeSequence - a.scopeSequence)
				.slice(0, 128),
			deliveries: deliveries.rows,
			dispatchMode: 'authorized-session',
			limits: { artifactPage: 128, drafts: 256, connections: 64 }
		}
	}
	async preview(raw: unknown, security?: PlanRunSecurityContext) {
		if (!security || !this.authoring) throw new StudioConflict('STUDIO_AUTHORING_UNCONFIGURED')
		return this.authoring.preview(raw, security)
	}
	private async validateInputs(
		definition: StudioSkillV2,
		bindings: Record<string, string | string[] | null>,
		arrivalPort?: string
	) {
		if (
			Object.keys(bindings).some(
				(name) => !Object.hasOwn(definition.inputs, name) || name === arrivalPort
			)
		)
			throw new StudioAdmissionRejected(
				'Only bind the named inputs; an arrival supplies its own input.'
			)
		for (const [name, port] of Object.entries(definition.inputs)) {
			if (name === arrivalPort) continue
			const binding = bindings[name]
			const members = binding == null ? [] : Array.isArray(binding) ? binding : [binding]
			if (
				(port.cardinality === 'one' && members.length !== 1) ||
				(port.cardinality === 'optional' && members.length > 1) ||
				members.length > definition.policy.maxMembers
			)
				throw new StudioAdmissionRejected(
					`Choose ${port.cardinality === 'one' ? 'one item' : 'a bounded collection'} for ${name}.`
				)
			for (const id of members) {
				const artifact = await this.artifacts.get(id)
				if (port.type.key !== artifact.typeKey || port.type.version !== artifact.typeVersion)
					throw new StudioAdmissionRejected(`The ${name} input has the wrong type.`)
			}
		}
	}
	async start(
		data: {
			requestId: string
			skillArtifactId: string
			inputs: Record<string, string | string[] | null>
			parameters?: Record<string, unknown>
		},
		security: PlanRunSecurityContext,
		context: PlanRunExecutionContext,
		subscription?: { artifactId: string; epoch: string }
	) {
		const skill = await this.artifacts.get(data.skillArtifactId)
		if (skill.typeKey !== 'studio.skill' || skill.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION)
			throw new StudioAdmissionRejected('Choose an exact Skill v2 artifact.')
		const definition = parseStudioSkillV2(skill.payload)
		const parameters = parseStudioSkillParameters(definition, data.parameters ?? {})
		await this.validateInputs(definition, data.inputs)
		const activationId = await studioIdentity(
			this.artifacts.scope,
			security.principal.subjectId,
			'activation',
			data.requestId
		)
		const [activation] = await this.artifacts.publish({
			id: activationId,
			procedure: 'studio.activate',
			principal: security.principal.subjectId,
			epoch: subscription?.epoch,
			inputs: [
				{ role: 'program', id: data.skillArtifactId },
				...Object.values(data.inputs)
					.flatMap((value) => (value == null ? [] : Array.isArray(value) ? value : [value]))
					.map((id) => ({ role: 'source', id })),
				...(subscription ? [{ role: 'subscription', id: subscription.artifactId }] : [])
			],
			parameters: { contractVersion: 2, definitionSha256: studioPlanDigest(definition) },
			artifacts: [
				{
					key: 'activation',
					type: 'studio.activation',
					version: 2,
					payload: {
						contractVersion: 2,
						activationId,
						skillArtifactId: data.skillArtifactId,
						inputs: data.inputs,
						parameters,
						initiator: security.principal.subjectId,
						origin: subscription ? 'subscription' : 'manual',
						subscriptionArtifactId: subscription?.artifactId ?? null
					}
				}
			]
		})
		return this.runner.start(
			{
				protocol: ACTOR_RUN_PROTOCOL,
				requestId: data.requestId,
				idempotencyKey: activationId,
				requestedAt: activation!.committedAt,
				skillRef: STUDIO_SKILL_V2,
				executionEnvironment: 'server',
				ingredients: [
					{ predicate: 'ceo.aven.studio.activation(request)', artifactId: activation!.artifactId }
				],
				goals: ['ceo.aven.studio.completed(request)'],
				parameters: { activationArtifactId: activation!.artifactId },
				security
			},
			context
		)
	}
	private async connect(raw: unknown, subject: string) {
		const d = z
			.object({
				id: uuid,
				name: z.string().min(1).max(160),
				skillArtifactId: uuid,
				sourceArtifactId: z
					.uuid({
						error:
							'sourceArtifactId must be an exact Source UUID or JSON null for any source; strings such as "None" or "null" are not valid.'
					})
					.nullable(),
				inputPort: z.string().min(1).max(64),
				fixedInputs: inputBindings,
				collection: z
					.object({ mode: z.enum(['each', 'accumulate']), initial: z.array(uuid).max(256) })
					.strict(),
				origin: z
					.object({
						procedureKey: z.string().min(1).max(256),
						procedureVersion: z.string().min(1).max(64)
					})
					.strict()
					.nullable(),
				parameters: z.record(z.string(), z.unknown()).default({}),
				enabled: z.boolean()
			})
			.strict()
			.parse(raw)
		return withStudioLock(this.database, subject, async (connectionLock) => {
			const skill = await this.artifacts.get(d.skillArtifactId)
			if (skill.typeKey !== 'studio.skill' || skill.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION)
				throw new StudioAdmissionRejected('Choose an exact Skill v2 artifact.')
			const definition = parseStudioSkillV2(skill.payload)
			const input = definition.inputs[d.inputPort]
			if (!input) throw new StudioAdmissionRejected('Choose a valid input port.')
			if (d.collection.mode === 'accumulate' && input.cardinality !== 'many')
				throw new StudioAdmissionRejected('A growing collection needs a collection input.')
			if (d.collection.mode === 'each' && d.collection.initial.length)
				throw new StudioAdmissionRejected('Initial items are only used with a growing collection.')
			if (new Set(d.collection.initial).size !== d.collection.initial.length)
				throw new StudioAdmissionRejected('Choose each initial item only once.')
			if (d.collection.mode === 'accumulate')
				await this.validateInputs(definition, {
					...d.fixedInputs,
					[d.inputPort]: d.collection.initial
				})
			const parameters = parseStudioSkillParameters(definition, d.parameters)
			await this.validateInputs(definition, d.fixedInputs, d.inputPort)
			if (
				d.sourceArtifactId &&
				(await this.artifacts.get(d.sourceArtifactId)).typeKey !== 'studio.source'
			)
				throw new StudioAdmissionRejected('Choose a registered Source.')
			// Every internal Actor publication reaches the feed, not just public Skill outputs.
			// Admit the new edge only when the subject's complete connection type graph stays acyclic.
			const produced = await producedArtifactTypes(this.artifacts, definition)
			const connected = await connectionLock.query(
				'SELECT * FROM studio_connections WHERE subject_id=$1 ORDER BY id LIMIT 64',
				[subject]
			)
			const edges: Array<[string, string]> = []
			for (const row of connected.rows) {
				const rule = row.record as Record<string, any>
				const saved = await this.artifacts.get(String(rule.skillArtifactId))
				const outputs = await producedArtifactTypes(
					this.artifacts,
					parseStudioSkillV2(saved.payload)
				)
				for (const output of outputs) edges.push([typeIdentity(rule.inputType), output])
			}
			for (const output of produced) edges.push([typeIdentity(input.type), output])
			if (containsDirectedCycle(edges))
				throw new StudioAdmissionRejected(
					'This connection would allow a feedback loop. Use a source stage whose outputs do not feed back into its inputs.'
				)
			const generation = await studioIdentity(this.artifacts.scope, subject, 'connection', d.id)
			const payload = {
				contractVersion: 3,
				subscriptionId: d.id,
				name: d.name,
				skillArtifactId: d.skillArtifactId,
				sourceArtifactId: d.sourceArtifactId,
				inputType: input.type,
				inputPort: d.inputPort,
				fixedInputs: d.fixedInputs,
				collection: d.collection,
				origin: d.origin,
				parameters,
				generation
			}
			const receipt = (artifactId: string, startsAfter: number, enabled: boolean) => ({
				id: d.id,
				artifactId,
				skillArtifactId: d.skillArtifactId,
				inputPort: d.inputPort,
				inputType: input.type,
				startsAfter,
				enabled,
				origin: d.origin,
				collection: { mode: d.collection.mode, initialCount: d.collection.initial.length },
				limits: {
					collectionMembers: Math.min(256, definition.policy.maxMembers),
					skillPolicy: definition.policy
				},
				dispatchMode: 'authorized-session',
				notice:
					'Future arrivals are processed while an authenticated workspace session synchronizes. Each run retains an immutable input snapshot and outputs; individual operations can impose stricter limits than the Skill policy. This receipt confirms the connection, not a completed run.'
			})
			const existing = (
				await connectionLock.query(
					'SELECT * FROM studio_connections WHERE id=$1 AND subject_id=$2',
					[d.id, subject]
				)
			).rows[0]
			if (existing) {
				if (studioPlanDigest(existing.record) !== studioPlanDigest(payload))
					throw new StudioConflict('This connection identity already has different content.')
				return receipt(existing.artifact_id, Number(existing.after_sequence), existing.enabled)
			}
			const count = await connectionLock.query(
				'SELECT count(*)::int AS count FROM studio_connections WHERE subject_id=$1',
				[subject]
			)
			if (count.rows[0].count >= 64)
				throw new StudioAdmissionRejected('The connection limit was reached.')
			// A committed subscription can outlive a failed head insert. Retry must keep
			// its original activation boundary, including arrivals during the outage.
			const previous = await this.artifacts.client.publication(this.artifacts.scope, generation)
			const savedPoint = previous ? studioObject(studioObject(previous).run).parameters : null
			const point = savedPoint
				? z
						.object({ epoch: uuid, sequence: z.number().int().nonnegative() })
						.strict()
						.parse(savedPoint)
				: await this.artifacts.highWater()
			const [artifact] = await this.artifacts.publish({
				id: generation,
				procedure: 'studio.subscribe',
				principal: subject,
				inputs: [
					{ role: 'program', id: d.skillArtifactId },
					...d.collection.initial.map((id) => ({ role: 'initial', id })),
					...(d.sourceArtifactId ? [{ role: 'source', id: d.sourceArtifactId }] : []),
					...Object.values(d.fixedInputs)
						.flatMap((value) => (value == null ? [] : Array.isArray(value) ? value : [value]))
						.map((id) => ({ role: 'fixed', id }))
				],
				parameters: point,
				artifacts: [
					{
						key: 'subscription',
						type: 'studio.subscription',
						version: 4,
						payload,
						references: [{ role: 'skill', id: d.skillArtifactId }]
					}
				]
			})
			const inserted = await connectionLock.query(
				'INSERT INTO studio_connections(id,subject_id,artifact_id,record,enabled,store_epoch,after_sequence,activated_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5 THEN clock_timestamp() ELSE NULL END) ON CONFLICT(id) DO NOTHING RETURNING id',
				[d.id, subject, artifact!.artifactId, payload, d.enabled, point.epoch, point.sequence]
			)
			if (!inserted.rowCount)
				throw new StudioConflict(
					'The connection was saved concurrently. Refresh before continuing.'
				)
			return receipt(artifact!.artifactId, point.sequence, d.enabled)
		})
	}
	/** Called only under fresh customer admission. A persisted rule is not an unattended credential. */
	async sync(security: PlanRunSecurityContext, context: PlanRunExecutionContext) {
		const subject = security.principal.subjectId
		const connections = await this.database.query(
			'SELECT * FROM studio_connections WHERE subject_id=$1 AND enabled=true ORDER BY id LIMIT 64',
			[subject]
		)
		let queued = 0
		for (const connection of connections.rows) {
			try {
				const rule = connection.record
				if (rule.contractVersion !== 3)
					throw new StudioConflict('Recreate this connection with the current collection contract.')
				const skill = await this.artifacts.get(rule.skillArtifactId)
				const input = parseStudioSkillV2(skill.payload).inputs[rule.inputPort]
				if (!input) throw new StudioConflict('The connected input no longer exists.')
				const page = await this.artifacts.feed(
					connection.store_epoch,
					Number(connection.after_sequence),
					8
				)
				for (const publication of page.items ?? []) {
					const production = rule.origin
						? studioObject(
								await this.artifacts.client.publication(
									this.artifacts.scope,
									publication.publicationId
								)
							)
						: null
					const originMatches =
						!rule.origin ||
						(production?.run?.procedureKey === rule.origin.procedureKey &&
							(rule.origin.procedureVersion === '*' ||
								production?.run?.procedureVersion === rule.origin.procedureVersion))
					const artifacts = await Promise.all(
						publication.artifacts.map((a: any) => this.artifacts.get(a.artifactId))
					)
					const sourceMatches =
						!rule.sourceArtifactId ||
						artifacts.some(
							(a) =>
								a.typeKey === 'studio.email' && a.payload.sourceArtifactId === rule.sourceArtifactId
						)
					const candidates =
						sourceMatches && originMatches
							? artifacts.filter(
									(a) =>
										a.typeKey === rule.inputType.key &&
										a.typeVersion === rule.inputType.version &&
										!rule.collection.initial.includes(a.artifactId)
								)
							: []
					const deliveries = await Promise.all(
						candidates
							.sort((a, b) => a.artifactId.localeCompare(b.artifactId))
							.map(async (a, ordinal) => ({
								id: await studioIdentity(this.artifacts.scope, rule.generation, a.artifactId),
								record: {
									triggerArtifactId: a.artifactId,
									sequence: publication.scopeSequence,
									ordinal,
									collectionMode: rule.collection.mode,
									skillArtifactId: rule.skillArtifactId,
									inputs: {
										...rule.fixedInputs,
										[rule.inputPort]: input.cardinality === 'many' ? [a.artifactId] : a.artifactId
									},
									parameters: rule.parameters ?? {},
									subscriptionArtifactId: connection.artifact_id,
									epoch: connection.store_epoch
								}
							}))
					)
					const tx = await this.database.connect()
					try {
						await tx.query('BEGIN')
						// The backlog limit is per subject, not per connection. Serialize
						// allocation across connections before checking it; otherwise two
						// clients can both observe spare capacity and exceed the bound.
						const allocationLock = await tx.query(
							'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
							[subject]
						)
						if (!allocationLock.rows[0].acquired) {
							await tx.query('ROLLBACK')
							// Retry this cursor on the next sync, never skip to a later publication.
							break
						}
						const current = await tx.query(
							'SELECT enabled,revision,after_sequence FROM studio_connections WHERE id=$1 AND subject_id=$2 FOR UPDATE',
							[connection.id, subject]
						)
						const row = current.rows[0]
						if (
							!row?.enabled ||
							row.revision !== connection.revision ||
							Number(row.after_sequence) >= publication.scopeSequence
						) {
							await tx.query('ROLLBACK')
							continue
						}
						const backlog = await tx.query(
							'SELECT count(*)::int AS count FROM studio_deliveries WHERE subject_id=$1 AND run_id IS NULL',
							[subject]
						)
						if (backlog.rows[0].count + deliveries.length > 256)
							throw new StudioConflict(
								'Pending work reached its limit. Let current work finish before syncing.'
							)
						if (rule.collection.mode === 'accumulate' && deliveries.length) {
							// Freeze an ordered input snapshot while holding the connection cursor lock.
							// Concurrent syncs cannot omit an earlier admitted arrival or mutate a past run.
							const previous = await tx.query(
								"SELECT record FROM studio_deliveries WHERE connection_id=$1 AND subject_id=$2 ORDER BY (record->>'sequence')::bigint,(record->>'ordinal')::int LIMIT 257",
								[connection.id, subject]
							)
							const members: string[] = [
								...rule.collection.initial,
								...previous.rows.map((row) => row.record.triggerArtifactId)
							]
							for (const delivery of deliveries) {
								members.push(delivery.record.triggerArtifactId)
								if (
									members.length >
									Math.min(256, parseStudioSkillV2(skill.payload).policy.maxMembers)
								)
									throw new StudioConflict(
										'The growing collection reached its Skill limit. Refine the scope or increase its reviewed member limit; no arrivals were skipped.'
									)
								delivery.record.inputs[rule.inputPort] = [...members]
							}
						}
						for (const delivery of deliveries)
							await tx.query(
								'INSERT INTO studio_deliveries(id,subject_id,connection_id,record) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
								[delivery.id, subject, connection.id, delivery.record]
							)
						await tx.query(
							'UPDATE studio_connections SET after_sequence=$1,last_error=NULL WHERE id=$2',
							[publication.scopeSequence, connection.id]
						)
						await tx.query('COMMIT')
						queued += deliveries.length
					} catch (error) {
						await tx.query('ROLLBACK')
						throw error
					} finally {
						tx.release()
					}
				}
			} catch (error) {
				await this.database.query(
					'UPDATE studio_connections SET last_error=$1 WHERE id=$2 AND subject_id=$3',
					[
						String(error instanceof Error ? error.message : 'Sync failed').slice(0, 2000),
						connection.id,
						subject
					]
				)
			}
		}
		const pending = await this.database.query(
			`SELECT d.* FROM studio_deliveries d
			 JOIN studio_connections c ON c.id=d.connection_id
			 WHERE d.subject_id=$1 AND d.run_id IS NULL AND c.enabled=true
			 AND c.record->>'contractVersion'='3'
			 AND (d.record->>'collectionMode' <> 'accumulate' OR NOT EXISTS (
			   SELECT 1 FROM studio_deliveries earlier LEFT JOIN runs r ON r.id=earlier.run_id
			   WHERE earlier.connection_id=d.connection_id AND earlier.subject_id=d.subject_id
			   AND ((earlier.record->>'sequence')::bigint,(earlier.record->>'ordinal')::int)
			     < ((d.record->>'sequence')::bigint,(d.record->>'ordinal')::int)
			   AND (earlier.run_id IS NULL OR r.state IS DISTINCT FROM 'succeeded')
			 ))
			 ORDER BY d.created_at, (d.record->>'sequence')::bigint, (d.record->>'ordinal')::int LIMIT 32`,
			[subject]
		)
		for (const delivery of pending.rows) {
			const admission = await this.database.connect()
			let transactionOpen = false
			try {
				await admission.query('BEGIN')
				transactionOpen = true
				const admissionLock = await admission.query(
					'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
					[subject]
				)
				if (!admissionLock.rows[0].acquired) continue
				// Serialize admission with pause/resume and other syncs. Once pause
				// returns, no later admission can slip through a stale pending page.
				const current = await admission.query(
					`SELECT c.enabled,d.run_id FROM studio_connections c
					 JOIN studio_deliveries d ON d.connection_id=c.id
					 WHERE d.id=$1 AND c.subject_id=$2 AND d.subject_id=$2 FOR UPDATE OF c,d SKIP LOCKED`,
					[delivery.id, subject]
				)
				if (!current.rows[0]?.enabled || current.rows[0].run_id) continue
				if (delivery.record.collectionMode === 'accumulate') {
					const earlier = await admission.query(
						`SELECT d.id FROM studio_deliveries d LEFT JOIN runs r ON r.id=d.run_id WHERE d.connection_id=$1 AND d.subject_id=$2 AND ((d.record->>'sequence')::bigint,(d.record->>'ordinal')::int) < ($3::bigint,$4::int) AND (d.run_id IS NULL OR r.state IS DISTINCT FROM 'succeeded') LIMIT 1`,
						[delivery.connection_id, subject, delivery.record.sequence, delivery.record.ordinal]
					)
					if (earlier.rowCount) continue
				}
				const active = await admission.query(
					"SELECT count(*)::int AS count FROM runs WHERE subject_id=$1 AND record->>'skillRef'=$2 AND state IN ('accepted','planning','running','waiting_for_input')",
					[subject, STUDIO_SKILL_V2]
				)
				if (active.rows[0].count >= 32) break
				const r = delivery.record
				const run = await this.start(
					{
						requestId: delivery.id,
						skillArtifactId: r.skillArtifactId,
						inputs: r.inputs,
						parameters: r.parameters ?? {}
					},
					security,
					context,
					{ artifactId: r.subscriptionArtifactId, epoch: r.epoch }
				)
				await admission.query(
					'UPDATE studio_deliveries SET run_id=$1,last_error=NULL WHERE id=$2',
					[run.runId, delivery.id]
				)
				await admission.query('COMMIT')
				transactionOpen = false
			} catch (error) {
				if (transactionOpen) await admission.query('ROLLBACK')
				transactionOpen = false
				await admission.query('UPDATE studio_deliveries SET last_error=$1 WHERE id=$2', [
					String(error instanceof Error ? error.message : 'Admission failed').slice(0, 2000),
					delivery.id
				])
			} finally {
				// Also releases locks when an earlier snapshot is still running.
				try {
					if (transactionOpen) await admission.query('ROLLBACK')
				} finally {
					admission.release()
				}
			}
		}
		return { queued, dispatchMode: 'authorized-session' }
	}
}

/** Never occupy a scarce pool slot while waiting for another Studio command.
 * Admission holds one slot while the runner briefly uses another. All connection
 * writers use the same lock; sync takes it non-blockingly and retries its cursor. */
async function withStudioLock<T>(
	database: pg.Pool,
	subject: string,
	work: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
	const deadline = Date.now() + 20_000
	while (Date.now() < deadline) {
		const client = await database.connect()
		let acquired = false
		let releaseError: Error | undefined
		try {
			acquired = (
				await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [
					subject
				])
			).rows[0].acquired
			if (acquired) return await work(client)
		} finally {
			try {
				if (acquired)
					await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [subject])
			} catch (error) {
				releaseError = error instanceof Error ? error : new Error(String(error))
				// Discarding this session releases its lock. Preserve the actual
				// command outcome rather than masking an already committed result.
			} finally {
				client.release(releaseError)
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	throw new StudioConflict(
		'Another connection change is still in progress. Check its state and retry this same request.'
	)
}

async function producedArtifactTypes(
	artifacts: StudioArtifacts,
	root: StudioSkillV2
): Promise<Set<string>> {
	const produced = new Set<string>()
	// Every accepted run emits an activation before any declared Actor output.
	// It is part of the same causal graph and must not be watched recursively.
	produced.add('studio.activation@2')
	const visited = new Set<string>()
	const collect = (definition: StudioSkillV2) => {
		const walk = (steps: StudioSkillV2['steps']) => {
			for (const step of steps) {
				for (const output of Object.values(step.outputs)) produced.add(typeIdentity(output.type))
				if (step.kind === 'when')
					for (const branch of Object.values(step.branches)) walk(branch.steps)
			}
		}
		walk(definition.steps)
	}
	const pending: StudioSkillV2[] = [root]
	while (pending.length) {
		const definition = pending.shift()!
		collect(definition)
		for (const id of studioSkillChildReferences(definition)) {
			if (visited.has(id)) continue
			visited.add(id)
			if (visited.size > 64) throw new StudioConflict('The nested Skill limit was reached.')
			const artifact = await artifacts.get(id)
			if (
				artifact.typeKey !== 'studio.skill' ||
				artifact.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION
			)
				throw new StudioConflict('An exact nested Skill is unavailable.')
			pending.push(parseStudioSkillV2(artifact.payload))
		}
	}
	return produced
}

function typeIdentity(type: { key: string; version: number }): string {
	return `${type.key}@${type.version}`
}

function containsDirectedCycle(edges: Array<[string, string]>): boolean {
	const graph = new Map<string, Set<string>>()
	for (const [from, to] of edges) {
		const targets = graph.get(from) ?? new Set<string>()
		targets.add(to)
		graph.set(from, targets)
	}
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const visit = (node: string): boolean => {
		if (visiting.has(node)) return true
		if (visited.has(node)) return false
		visiting.add(node)
		for (const next of graph.get(node) ?? []) if (visit(next)) return true
		visiting.delete(node)
		visited.add(node)
		return false
	}
	return [...graph.keys()].some(visit)
}
