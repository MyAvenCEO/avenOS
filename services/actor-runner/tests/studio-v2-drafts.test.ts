import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { describe, expect, test, vi } from 'vitest'
import { StudioV2DraftConflict, StudioV2Drafts } from '../src/studio-v2-drafts'

const port = {
	schema: 'fixture:input@1',
	type: { key: 'fixture.input', version: 1 },
	predicate: 'fixture.input(X)',
	role: 'source',
	cardinality: 'one'
}
function definition(name = 'Fresh Skill') {
	return {
		version: 2,
		name,
		inputs: { source: port },
		parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
		steps: [],
		outputs: { source: { ...port, from: { kind: 'input', port: 'source' } } },
		policy: {
			maxInvocations: 8,
			maxDepth: 3,
			maxMembers: 8,
			maxConcurrentChildren: 2,
			allowModel: false
		}
	}
}

function database() {
	const rows = new Map<string, any>()
	const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
		if (
			sql === 'BEGIN' ||
			sql === 'COMMIT' ||
			sql === 'ROLLBACK' ||
			sql.startsWith('SELECT pg_advisory_xact_lock')
		)
			return { rowCount: 0, rows: [] }
		if (sql.startsWith('SELECT count(*)')) {
			const count = [...rows.values()].filter((item) => item.subject_id === parameters[0]).length
			return { rowCount: 1, rows: [{ count }] }
		}
		if (sql === 'SELECT * FROM studio_drafts WHERE id=$1') {
			const item = rows.get(String(parameters[0]))
			return { rowCount: item ? 1 : 0, rows: item ? [structuredClone(item)] : [] }
		}
		if (sql.startsWith('SELECT * FROM studio_drafts WHERE id=$1 AND subject_id=$2')) {
			const item = rows.get(String(parameters[0]))
			const found = item?.subject_id === parameters[1] ? item : null
			return { rowCount: found ? 1 : 0, rows: found ? [structuredClone(found)] : [] }
		}
		if (sql.startsWith('SELECT * FROM studio_drafts WHERE subject_id=$1')) {
			const found = [...rows.values()].filter((item) => item.subject_id === parameters[0])
			return { rowCount: found.length, rows: structuredClone(found) }
		}
		if (sql.startsWith('INSERT INTO studio_drafts')) {
			const item = {
				id: parameters[0],
				subject_id: parameters[1],
				definition: parameters[2],
				revision: 1,
				published_artifact_id: null,
				published_revision: null,
				updated_at: new Date('2026-09-16T05:00:00Z')
			}
			rows.set(String(item.id), item)
			return { rowCount: 1, rows: [structuredClone(item)] }
		}
		if (sql.startsWith('UPDATE studio_drafts SET definition=')) {
			const item = rows.get(String(parameters[1]))
			if (!item || item.subject_id !== parameters[2] || item.revision !== parameters[3])
				return { rowCount: 0, rows: [] }
			item.definition = parameters[0]
			item.revision++
			return { rowCount: 1, rows: [structuredClone(item)] }
		}
		if (sql.startsWith('UPDATE studio_drafts SET published_artifact_id=')) {
			const item = rows.get(String(parameters[2]))
			if (
				!item ||
				item.subject_id !== parameters[3] ||
				item.revision !== parameters[1] ||
				(item.published_revision !== null &&
					item.published_revision >= Number(parameters[1]) &&
					(item.published_revision !== parameters[1] ||
						item.published_artifact_id !== parameters[0]))
			)
				return { rowCount: 0, rows: [] }
			item.published_artifact_id = parameters[0]
			item.published_revision = parameters[1]
			return { rowCount: 1, rows: [structuredClone(item)] }
		}
		throw new Error(`Unhandled SQL: ${sql}`)
	})
	const client = { query, release: vi.fn() }
	return { rows, query, client, pool: { query, connect: async () => client } as unknown as pg.Pool }
}

describe('fresh v2 Studio draft CAS', () => {
	test('creates idempotently, rejects identity reuse, and updates one exact revision', async () => {
		const db = database()
		const drafts = new StudioV2Drafts(db.pool)
		const id = randomUUID()
		const subject = randomUUID()
		const created = await drafts.save({ id, revision: 0, definition: definition() }, subject)
		expect(created).toMatchObject({
			id,
			subjectId: subject,
			revision: 1,
			publishedArtifactId: null
		})
		expect(
			(await drafts.save({ id, revision: 0, definition: definition() }, subject)).revision
		).toBe(1)
		await expect(
			drafts.save({ id, revision: 0, definition: definition('Different') }, subject)
		).rejects.toThrow('DRAFT_ID_CONFLICT')
		const changed = await drafts.save(
			{ id, revision: 1, definition: definition('Changed') },
			subject
		)
		expect(changed.revision).toBe(2)
		await expect(
			drafts.save({ id, revision: 1, definition: definition('Stale') }, subject)
		).rejects.toThrow('DRAFT_CHANGED')
		expect(db.client.release).toHaveBeenCalledTimes(3)
	})

	test('rejects an old definition before mutable storage is touched', async () => {
		const db = database()
		const drafts = new StudioV2Drafts(db.pool)
		await expect(
			drafts.save(
				{ id: randomUUID(), revision: 0, definition: { version: 1, name: 'Old' } },
				randomUUID()
			)
		).rejects.toThrow()
		expect(db.query).not.toHaveBeenCalled()
	})

	test('records one exact published head while retaining its predecessor for later edits', async () => {
		const db = database()
		const drafts = new StudioV2Drafts(db.pool)
		const id = randomUUID()
		const subject = randomUUID()
		const artifact = randomUUID()
		await drafts.save({ id, revision: 0, definition: definition() }, subject)
		const published = await drafts.markPublished(id, subject, 1, artifact)
		expect(published).toMatchObject({ publishedArtifactId: artifact, publishedRevision: 1 })
		expect((await drafts.markPublished(id, subject, 1, artifact)).publishedArtifactId).toBe(
			artifact
		)
		await expect(drafts.markPublished(id, subject, 1, randomUUID())).rejects.toThrow(
			'DRAFT_CHANGED_AFTER_PUBLICATION'
		)
		const edited = await drafts.save({ id, revision: 1, definition: definition('Next') }, subject)
		expect(edited).toMatchObject({
			revision: 2,
			publishedArtifactId: artifact,
			publishedRevision: 1
		})
		const nextArtifact = randomUUID()
		const next = await drafts.markPublished(id, subject, 2, nextArtifact)
		expect(next).toMatchObject({
			revision: 2,
			publishedRevision: 2,
			publishedArtifactId: nextArtifact
		})
		expect((await drafts.markPublished(id, subject, 2, nextArtifact)).publishedArtifactId).toBe(
			nextArtifact
		)
		await expect(drafts.markPublished(id, subject, 1, artifact)).rejects.toThrow(
			'DRAFT_CHANGED_AFTER_PUBLICATION'
		)
	})

	test('never exposes another subject draft', async () => {
		const db = database()
		const drafts = new StudioV2Drafts(db.pool)
		const id = randomUUID()
		await drafts.save({ id, revision: 0, definition: definition() }, randomUUID())
		await expect(drafts.get(id, randomUUID())).rejects.toBeInstanceOf(StudioV2DraftConflict)
	})
})
