import { parseStudioSkillV2, type StudioSkillV2 } from '@avenos/actors'
import type pg from 'pg'
import { studioPlanDigest } from './studio-artifacts.js'
import {
	lockDraftOperation,
	readDraftReceipt,
	recordDraftReceipt,
	type StudioDraftOperation
} from './studio-draft-receipts.js'

export interface StudioV2DraftRecord {
	id: string
	subjectId: string
	revision: number
	definition: StudioSkillV2
	publishedArtifactId: string | null
	publishedRevision: number | null
	updatedAt: string
	originArtifactId?: string | null
}

export class StudioV2DraftConflict extends Error {
	constructor(
		message: string,
		readonly effect: 'not-applied' | 'uncertain' = 'not-applied'
	) {
		super(message)
	}
}

/** Internal proof supplied only after the authoring boundary has checked case ancestry. */
export interface StudioCaseTransition {
	from: string | undefined
	to: string
}

export interface StudioV2DraftStore {
	list(subjectId: string): Promise<StudioV2DraftRecord[]>
	get(id: string, subjectId: string): Promise<StudioV2DraftRecord>
	save(
		input: { id: string; revision: number; definition: unknown; originArtifactId?: string },
		subjectId: string,
		caseTransition?: StudioCaseTransition
	): Promise<StudioV2DraftRecord>
	markPublished(
		id: string,
		subjectId: string,
		revision: number,
		artifactId: string
	): Promise<StudioV2DraftRecord>
}

/** Fresh-schema v2 draft CAS. It neither reads nor converts v1 definitions. */
export class StudioV2Drafts implements StudioV2DraftStore {
	constructor(
		readonly database: pg.Pool,
		private readonly operation?: StudioDraftOperation
	) {}

	async list(subjectId: string): Promise<StudioV2DraftRecord[]> {
		identity(subjectId, 'subjectId')
		const result = await this.database.query(
			'SELECT * FROM studio_drafts WHERE subject_id=$1 ORDER BY updated_at DESC LIMIT 256',
			[subjectId]
		)
		return result.rows.map(row)
	}

	async get(id: string, subjectId: string): Promise<StudioV2DraftRecord> {
		identity(id, 'id')
		identity(subjectId, 'subjectId')
		const result = await this.database.query(
			'SELECT * FROM studio_drafts WHERE id=$1 AND subject_id=$2',
			[id, subjectId]
		)
		if (result.rowCount !== 1) throw new StudioV2DraftConflict('DRAFT_UNAVAILABLE')
		return row(result.rows[0])
	}

	async save(
		input: { id: string; revision: number; definition: unknown; originArtifactId?: string },
		subjectId: string,
		caseTransition?: StudioCaseTransition
	): Promise<StudioV2DraftRecord> {
		identity(input.id, 'id')
		identity(subjectId, 'subjectId')
		if (!Number.isSafeInteger(input.revision) || input.revision < 0)
			throw new StudioV2DraftConflict('DRAFT_REVISION_INVALID')
		const definition = parseStudioSkillV2(input.definition)
		if (input.originArtifactId) identity(input.originArtifactId, 'originArtifactId')
		const client = await this.database.connect()
		try {
			await client.query('BEGIN')
			if (this.operation) {
				await lockDraftOperation(client, this.operation, subjectId)
				// Recovery reads the receipt, never calls save again. Refuse accidental
				// redispatch even if the proposed definition happens to match.
				if (await readDraftReceipt(client, this.operation))
					throw new StudioV2DraftConflict(
						'DRAFT_OPERATION_ALREADY_SAVED: recover its receipt.',
						'uncertain'
					)
			}
			const saved = await this.#save(client, input, subjectId, definition, caseTransition)
			if (this.operation) await recordDraftReceipt(client, this.operation, saved)
			await client.query('COMMIT')
			return saved
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {})
			throw error
		} finally {
			client.release()
		}
	}

	async #save(
		client: pg.PoolClient,
		input: { id: string; revision: number; originArtifactId?: string },
		subjectId: string,
		definition: StudioSkillV2,
		caseTransition?: StudioCaseTransition
	): Promise<StudioV2DraftRecord> {
		if (input.revision === 0)
			return this.#create(client, input.id, subjectId, definition, input.originArtifactId ?? null)
		const found = await client.query('SELECT * FROM studio_drafts WHERE id=$1 AND subject_id=$2', [
			input.id,
			subjectId
		])
		if (found.rowCount !== 1) throw new StudioV2DraftConflict('DRAFT_UNAVAILABLE')
		const previous = row(found.rows[0])
		if (
			input.originArtifactId !== undefined &&
			input.originArtifactId !== previous.originArtifactId
		)
			throw new StudioV2DraftConflict('Keep this draft’s original Skill provenance.')
		if (
			previous.definition.caseArtifactId !== definition.caseArtifactId &&
			(previous.publishedArtifactId ||
				!caseTransition ||
				caseTransition.from !== previous.definition.caseArtifactId ||
				caseTransition.to !== definition.caseArtifactId)
		)
			throw new StudioV2DraftConflict(
				"Keep this draft's original case reference. Start a new case revision to change its origin."
			)
		const result = await client.query(
			'UPDATE studio_drafts SET definition=$1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND subject_id=$3 AND revision=$4 AND (NOT $5::boolean OR published_artifact_id IS NULL) RETURNING *',
			[
				definition,
				input.id,
				subjectId,
				input.revision,
				previous.definition.caseArtifactId !== definition.caseArtifactId
			]
		)
		if (result.rowCount !== 1) throw new StudioV2DraftConflict('DRAFT_CHANGED')
		return row(result.rows[0])
	}

	async markPublished(
		id: string,
		subjectId: string,
		revision: number,
		artifactId: string
	): Promise<StudioV2DraftRecord> {
		identity(id, 'id')
		identity(subjectId, 'subjectId')
		identity(artifactId, 'artifactId')
		if (!Number.isSafeInteger(revision) || revision < 1)
			throw new StudioV2DraftConflict('DRAFT_REVISION_INVALID')
		const client = await this.database.connect()
		try {
			await client.query('BEGIN')
			if (this.operation) await lockDraftOperation(client, this.operation, subjectId)
			const result = await client.query(
				'UPDATE studio_drafts SET published_artifact_id=$1,published_revision=$2,updated_at=clock_timestamp() WHERE id=$3 AND subject_id=$4 AND revision=$2 AND (published_revision IS NULL OR published_revision<$2 OR (published_revision=$2 AND published_artifact_id=$1)) RETURNING *',
				[artifactId, revision, id, subjectId]
			)
			if (result.rowCount !== 1)
				throw new StudioV2DraftConflict('DRAFT_CHANGED_AFTER_PUBLICATION', 'uncertain')
			await client.query('COMMIT')
			return row(result.rows[0])
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {})
			throw error
		} finally {
			client.release()
		}
	}

	async #create(
		client: pg.PoolClient,
		id: string,
		subjectId: string,
		definition: StudioSkillV2,
		originArtifactId: string | null
	): Promise<StudioV2DraftRecord> {
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [subjectId])
		const existing = await client.query('SELECT * FROM studio_drafts WHERE id=$1', [id])
		if (existing.rowCount) {
			const current = row(existing.rows[0])
			if (
				current.subjectId !== subjectId ||
				current.originArtifactId !== originArtifactId ||
				studioPlanDigest(current.definition) !== studioPlanDigest(definition)
			)
				throw new StudioV2DraftConflict('DRAFT_ID_CONFLICT')
			return current
		}
		const count = await client.query(
			'SELECT count(*)::int AS count FROM studio_drafts WHERE subject_id=$1',
			[subjectId]
		)
		if (Number(count.rows[0]?.count) >= 256) throw new StudioV2DraftConflict('DRAFT_LIMIT_REACHED')
		const inserted = await client.query(
			'INSERT INTO studio_drafts(id,subject_id,definition,origin_artifact_id) VALUES($1,$2,$3,$4) RETURNING *',
			[id, subjectId, definition, originArtifactId]
		)
		return row(inserted.rows[0])
	}
}

function row(value: unknown): StudioV2DraftRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('DRAFT_ROW_INVALID')
	const record = value as Record<string, unknown>
	const definition = parseStudioSkillV2(record.definition)
	if (
		typeof record.id !== 'string' ||
		typeof record.subject_id !== 'string' ||
		!Number.isSafeInteger(record.revision) ||
		(record.origin_artifact_id !== null && typeof record.origin_artifact_id !== 'string') ||
		Number(record.revision) < 1 ||
		(record.published_artifact_id !== null && typeof record.published_artifact_id !== 'string') ||
		(record.published_revision !== null &&
			(!Number.isSafeInteger(record.published_revision) ||
				Number(record.published_revision) < 1)) ||
		(!(record.updated_at instanceof Date) && typeof record.updated_at !== 'string')
	)
		throw new Error('DRAFT_ROW_INVALID')
	return {
		id: record.id,
		originArtifactId: record.origin_artifact_id as string | null,
		subjectId: record.subject_id,
		revision: Number(record.revision),
		definition,
		publishedArtifactId: record.published_artifact_id as string | null,
		publishedRevision: record.published_revision as number | null,
		updatedAt:
			record.updated_at instanceof Date ? record.updated_at.toISOString() : record.updated_at
	}
}

function identity(value: string, field: string): void {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
		throw new StudioV2DraftConflict(`${field.toUpperCase()}_INVALID`)
}
