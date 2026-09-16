import {
	ACTOR_RUN_PROTOCOL,
	type ActorAuthorizer,
	type ActorRegistrySnapshot,
	composeCatalogOperation,
	newStudioSkillV2,
	type PlanRunExecutionContext,
	type PlanRunner,
	type PlanRunSecurityContext,
	parseStudioSkillParameters,
	parseStudioSkillV2,
	presentSkillArtifact,
	StudioCatalog,
	type StudioSkillV2,
	studioSkillChildReferences,
	type TrustedActorInstallation,
	type TrustedActorInstallations
} from '@avenos/actors'
import type pg from 'pg'
import { z } from 'zod'
import {
	type StudioArtifacts,
	studioIdentity,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'
import { StudioV2Authoring } from './studio-v2-authoring.js'
import { StudioV2Drafts } from './studio-v2-drafts.js'
import { STUDIO_SKILL_V2 } from './studio-v2-executor.js'
import { StudioV2SkillPublisher } from './studio-v2-publisher.js'

const uuid = z.uuid()
const ids = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), uuid)
const commandSchema = z
	.object({
		operation: z.enum([
			'catalog',
			'present',
			'state',
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
			'run-control'
		]),
		data: z.record(z.string(), z.unknown()).default({})
	})
	.strict()
export class StudioConflict extends Error {}
export const STUDIO_READ_OPERATIONS = [
	'state',
	'catalog',
	'present',
	'inspect',
	'explore',
	'preview',
	'compare'
] as const

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
		installations?: TrustedActorInstallations
	) {
		if (installations && catalogSource) {
			const publisher = new StudioV2SkillPublisher(artifacts, installations)
			this.authoring = new StudioV2Authoring(
				new StudioV2Drafts(database),
				publisher,
				async (security) => ({
					principal: security.principal,
					access: security.access,
					actorAuthorizer: await catalogSource.authorizer(security),
					resolveReadableSkill: (artifactId) => artifacts.get(artifactId),
					assertCanPublish: async () => {}
				})
			)
		}
	}
	async call(
		raw: unknown,
		security: PlanRunSecurityContext,
		context: PlanRunExecutionContext,
		readOnly: boolean
	) {
		const { operation, data } = commandSchema.parse(raw)
		if (readOnly && !(STUDIO_READ_OPERATIONS as readonly string[]).includes(operation))
			throw new StudioConflict('This operation requires write access.')
		const subject = security.principal.subjectId
		switch (operation) {
			case 'catalog': {
				const d = z
					.object({
						search: z.string().max(160).optional(),
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
			case 'state':
				z.object({}).strict().parse(data)
				return this.state(security)
			case 'inspect': {
				const d = z.object({ artifactId: uuid }).strict().parse(data)
				const artifact = await this.artifacts.get(d.artifactId)
				return {
					artifact,
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
				const page = await this.catalog.page({
					registry,
					authorizer,
					principal: security.principal,
					access: security.access,
					runtimeSupports: this.catalogSource.runtimeSupports,
					installationFor: this.catalogSource.installationFor,
					limit: 100
				})
				const opportunities = page.entries.flatMap((entry) => {
					if (
						!entry.canAuthor ||
						!entry.inputs.some(
							(port) =>
								port.type?.key === source.typeKey && port.type.version === source.typeVersion
						)
					)
						return []
					try {
						const composed = composeCatalogOperation(newStudioSkillV2(entry.label), entry)
						return [
							{
								label: entry.label,
								conditional: false,
								steps: [{ id: entry.capabilityId, label: entry.label }],
								definition: composed.definition
							}
						]
					} catch {
						return []
					}
				})
				return {
					source,
					opportunities,
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
					.object({ id: uuid, revision: z.number().int().nonnegative(), definition: z.unknown() })
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
						inputs: ids,
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
			case 'control': {
				const d = z
					.object({ id: uuid, revision: z.number().int().positive(), enabled: z.boolean() })
					.strict()
					.parse(data)
				const row = (
					await this.database.query(
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
				const updated = await this.database.query(
					'UPDATE studio_connections SET enabled=$1,revision=revision+1,updated_at=clock_timestamp(),store_epoch=$5,after_sequence=$6,activated_at=CASE WHEN $1 THEN coalesce(activated_at,clock_timestamp()) ELSE activated_at END WHERE id=$2 AND subject_id=$3 AND revision=$4 RETURNING *',
					[d.enabled, d.id, subject, d.revision, point.epoch, point.sequence]
				)
				if (!updated.rowCount)
					throw new StudioConflict('The connection changed. Refresh before continuing.')
				return updated.rows[0]
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
				'SELECT * FROM studio_connections WHERE subject_id=$1 ORDER BY updated_at DESC LIMIT 64',
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
				['studio.email', 'studio.understanding', 'studio.brief'].map((type) =>
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
	async start(
		data: {
			requestId: string
			skillArtifactId: string
			inputs: Record<string, string>
			parameters?: Record<string, unknown>
		},
		security: PlanRunSecurityContext,
		context: PlanRunExecutionContext,
		subscription?: { artifactId: string; epoch: string }
	) {
		const skill = await this.artifacts.get(data.skillArtifactId)
		if (skill.typeKey !== 'studio.skill' || skill.typeVersion !== 2)
			throw new StudioConflict('Choose an exact Skill v2 artifact.')
		const definition = parseStudioSkillV2(skill.payload)
		const parameters = parseStudioSkillParameters(definition, data.parameters ?? {})
		if (Object.keys(data.inputs).length !== Object.keys(definition.inputs).length)
			throw new StudioConflict('Bind every Skill input.')
		for (const [name, port] of Object.entries(definition.inputs)) {
			if (!data.inputs[name]) throw new StudioConflict(`Choose ${name}.`)
			const a = await this.artifacts.get(data.inputs[name]!)
			if (port.type.key !== a.typeKey || port.type.version !== a.typeVersion)
				throw new StudioConflict(`The ${name} input has the wrong type.`)
		}
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
				...Object.values(data.inputs).map((id) => ({ role: 'source', id })),
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
				sourceArtifactId: uuid.nullable(),
				inputPort: z.string().min(1).max(64),
				fixedInputs: ids,
				parameters: z.record(z.string(), z.unknown()).default({}),
				enabled: z.boolean()
			})
			.strict()
			.parse(raw)
		const connectionLock = await this.database.connect()
		let connectionLocked = false
		try {
			await connectionLock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [subject])
			connectionLocked = true
			const skill = await this.artifacts.get(d.skillArtifactId)
			if (skill.typeKey !== 'studio.skill' || skill.typeVersion !== 2)
				throw new StudioConflict('Choose an exact Skill v2 artifact.')
			const definition = parseStudioSkillV2(skill.payload)
			const input = definition.inputs[d.inputPort]
			if (!input) throw new StudioConflict('Choose a valid input port.')
			const parameters = parseStudioSkillParameters(definition, d.parameters)
			const others = Object.keys(definition.inputs).filter((k) => k !== d.inputPort)
			if (
				others.length !== Object.keys(d.fixedInputs).length ||
				others.some((k) => !d.fixedInputs[k])
			)
				throw new StudioConflict('Bind every companion input.')
			for (const [name, id] of Object.entries(d.fixedInputs)) {
				const a = await this.artifacts.get(id)
				const port = definition.inputs[name]!
				if (port.type.key !== a.typeKey || port.type.version !== a.typeVersion)
					throw new StudioConflict('Companion input type mismatch.')
			}
			if (
				d.sourceArtifactId &&
				(await this.artifacts.get(d.sourceArtifactId)).typeKey !== 'studio.source'
			)
				throw new StudioConflict('Choose a registered Source.')
			// Every internal Actor publication reaches the feed, not just public Skill outputs.
			// Admit the new edge only when the subject's complete connection type graph stays acyclic.
			const produced = await producedArtifactTypes(this.artifacts, definition)
			const connected = await this.database.query(
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
				throw new StudioConflict('This connection would allow a feedback loop.')
			const generation = await studioIdentity(this.artifacts.scope, subject, 'connection', d.id)
			const payload = {
				contractVersion: 2,
				subscriptionId: d.id,
				name: d.name,
				skillArtifactId: d.skillArtifactId,
				sourceArtifactId: d.sourceArtifactId,
				inputType: input.type,
				inputPort: d.inputPort,
				fixedInputs: d.fixedInputs,
				parameters,
				generation
			}
			const existing = (
				await this.database.query(
					'SELECT * FROM studio_connections WHERE id=$1 AND subject_id=$2',
					[d.id, subject]
				)
			).rows[0]
			if (existing) {
				if (studioPlanDigest(existing.record) !== studioPlanDigest(payload))
					throw new StudioConflict('This connection identity already has different content.')
				return {
					id: existing.id,
					artifactId: existing.artifact_id,
					startsAfter: Number(existing.after_sequence)
				}
			}
			const count = await this.database.query(
				'SELECT count(*)::int AS count FROM studio_connections WHERE subject_id=$1',
				[subject]
			)
			if (count.rows[0].count >= 64) throw new StudioConflict('The connection limit was reached.')
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
					...(d.sourceArtifactId ? [{ role: 'source', id: d.sourceArtifactId }] : []),
					...Object.values(d.fixedInputs).map((id) => ({ role: 'fixed', id }))
				],
				parameters: point,
				artifacts: [
					{
						key: 'subscription',
						type: 'studio.subscription',
						version: 2,
						payload,
						references: [{ role: 'skill', id: d.skillArtifactId }]
					}
				]
			})
			const inserted = await this.database.query(
				'INSERT INTO studio_connections(id,subject_id,artifact_id,record,enabled,store_epoch,after_sequence,activated_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5 THEN clock_timestamp() ELSE NULL END) ON CONFLICT(id) DO NOTHING RETURNING id',
				[d.id, subject, artifact!.artifactId, payload, d.enabled, point.epoch, point.sequence]
			)
			if (!inserted.rowCount)
				throw new StudioConflict(
					'The connection was saved concurrently. Refresh before continuing.'
				)
			return { id: d.id, artifactId: artifact!.artifactId, startsAfter: point.sequence }
		} finally {
			if (connectionLocked)
				await connectionLock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [subject])
			connectionLock.release()
		}
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
				const page = await this.artifacts.feed(
					connection.store_epoch,
					Number(connection.after_sequence),
					8
				)
				for (const publication of page.items ?? []) {
					const artifacts = await Promise.all(
						publication.artifacts.map((a: any) => this.artifacts.get(a.artifactId))
					)
					const rule = connection.record
					const sourceMatches =
						!rule.sourceArtifactId ||
						artifacts.some(
							(a) =>
								a.typeKey === 'studio.email' && a.payload.sourceArtifactId === rule.sourceArtifactId
						)
					const candidates = sourceMatches
						? artifacts.filter(
								(a) => a.typeKey === rule.inputType.key && a.typeVersion === rule.inputType.version
							)
						: []
					const deliveries = await Promise.all(
						candidates.map(async (a) => ({
							id: await studioIdentity(this.artifacts.scope, rule.generation, a.artifactId),
							record: {
								skillArtifactId: rule.skillArtifactId,
								inputs: { ...rule.fixedInputs, [rule.inputPort]: a.artifactId },
								parameters: rule.parameters ?? {},
								subscriptionArtifactId: connection.artifact_id,
								epoch: connection.store_epoch
							}
						}))
					)
					const tx = await this.database.connect()
					try {
						await tx.query('BEGIN')
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
			'SELECT d.* FROM studio_deliveries d JOIN studio_connections c ON c.id=d.connection_id WHERE d.subject_id=$1 AND d.run_id IS NULL AND c.enabled=true ORDER BY d.created_at LIMIT 32',
			[subject]
		)
		for (const delivery of pending.rows) {
			try {
				const active = await this.database.query(
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
				await this.database.query(
					'UPDATE studio_deliveries SET run_id=$1,last_error=NULL WHERE id=$2',
					[run.runId, delivery.id]
				)
			} catch (error) {
				await this.database.query('UPDATE studio_deliveries SET last_error=$1 WHERE id=$2', [
					String(error instanceof Error ? error.message : 'Admission failed').slice(0, 2000),
					delivery.id
				])
			}
		}
		return { queued, dispatchMode: 'authorized-session' }
	}
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
			if (artifact.typeKey !== 'studio.skill' || artifact.typeVersion !== 2)
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
