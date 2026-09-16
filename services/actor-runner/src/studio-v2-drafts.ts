import { parseStudioSkillV2, type StudioSkillV2 } from '@avenos/actors'
import type pg from 'pg'
import { studioPlanDigest } from './studio-artifacts.js'

export interface StudioV2DraftRecord {
	id: string
	subjectId: string
	revision: number
	definition: StudioSkillV2
	publishedArtifactId: string | null
	publishedRevision: number | null
	updatedAt: string
}

export class StudioV2DraftConflict extends Error {}

export interface StudioV2DraftStore {
	list(subjectId: string): Promise<StudioV2DraftRecord[]>
	get(id: string, subjectId: string): Promise<StudioV2DraftRecord>
	save(
		input: { id: string; revision: number; definition: unknown },
		subjectId: string
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
	constructor(readonly database: pg.Pool) {}

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
		input: { id: string; revision: number; definition: unknown },
		subjectId: string
	): Promise<StudioV2DraftRecord> {
		identity(input.id, 'id')
		identity(subjectId, 'subjectId')
		if (!Number.isSafeInteger(input.revision) || input.revision < 0)
			throw new StudioV2DraftConflict('DRAFT_REVISION_INVALID')
		const definition = parseStudioSkillV2(input.definition)
		if (input.revision === 0) return this.#create(input.id, subjectId, definition)
		const result = await this.database.query(
			'UPDATE studio_drafts SET definition=$1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND subject_id=$3 AND revision=$4 RETURNING *',
			[definition, input.id, subjectId, input.revision]
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
		const result = await this.database.query(
			'UPDATE studio_drafts SET published_artifact_id=$1,published_revision=$2,updated_at=clock_timestamp() WHERE id=$3 AND subject_id=$4 AND revision=$2 AND (published_revision IS NULL OR published_revision<$2 OR (published_revision=$2 AND published_artifact_id=$1)) RETURNING *',
			[artifactId, revision, id, subjectId]
		)
		if (result.rowCount !== 1) throw new StudioV2DraftConflict('DRAFT_CHANGED_AFTER_PUBLICATION')
		return row(result.rows[0])
	}

	async #create(
		id: string,
		subjectId: string,
		definition: StudioSkillV2
	): Promise<StudioV2DraftRecord> {
		const client = await this.database.connect()
		try {
			await client.query('BEGIN')
			await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [subjectId])
			const existing = await client.query('SELECT * FROM studio_drafts WHERE id=$1', [id])
			if (existing.rowCount) {
				const current = row(existing.rows[0])
				if (
					current.subjectId !== subjectId ||
					studioPlanDigest(current.definition) !== studioPlanDigest(definition)
				)
					throw new StudioV2DraftConflict('DRAFT_ID_CONFLICT')
				await client.query('COMMIT')
				return current
			}
			const count = await client.query(
				'SELECT count(*)::int AS count FROM studio_drafts WHERE subject_id=$1',
				[subjectId]
			)
			if (Number(count.rows[0]?.count) >= 256)
				throw new StudioV2DraftConflict('DRAFT_LIMIT_REACHED')
			const inserted = await client.query(
				'INSERT INTO studio_drafts(id,subject_id,definition) VALUES($1,$2,$3) RETURNING *',
				[id, subjectId, definition]
			)
			await client.query('COMMIT')
			return row(inserted.rows[0])
		} catch (error) {
			await client.query('ROLLBACK')
			throw error
		} finally {
			client.release()
		}
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
