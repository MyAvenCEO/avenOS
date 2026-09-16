import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { InvalidRetrievalCursor, type RetrievalInput, retrievalPage } from './retrieval.js'

pg.types.setTypeParser(20, Number)

export type IntentState = 'working' | 'waiting' | 'done' | 'error' | 'archive' | 'merged'
export type ActiveIntentState = 'working' | 'waiting' | 'done' | 'error'
export type ContributorKind = 'human' | 'agent'

export interface CreateIntent {
	id: string
	title: string
	intentType: string
	sourceLabel: string
	deadline: string | null
	routingSummary?: string
}

export interface UpdateIntent {
	expectedVersion: number
	title?: string
	intentType?: string
	sourceLabel?: string
	deadline?: string
	clearDeadline: boolean
	routingSummary?: string
	state?: ActiveIntentState
}

export interface ContributionInput {
	id: string
	contributorKind: ContributorKind
	kind: string
	text: string | null
	payload: Record<string, unknown>
}

export interface VersionCommand {
	id: string
	expectedVersion: number
}

export interface MergeCommand extends VersionCommand {
	commandId: string
	sources: Array<{ id: string; expectedVersion: number }>
}

export interface IntentSummary {
	id: string
	title: string
	intentType: string
	sourceLabel: string
	deadline: string | null
	routingSummary: string
	state: IntentState
	version: number
	sourceArtifactId: null
	createdAt: string
	updatedAt: string
}

export interface Contribution {
	id: string
	sequence: number
	contributorKind: 'human' | 'agent' | 'skill' | 'system'
	kind: string
	text: string | null
	payload: Record<string, unknown>
	createdAt: string
}

export interface IntentDetail extends IntentSummary {
	contributions: Contribution[]
	contributionsHasMore?: boolean
	artifacts: []
	fileSkill: null
}

export class IntentNotFoundError extends Error {}
export class IntentConflictError extends Error {}

type Queryable = pg.Pool | pg.PoolClient

const intentColumns =
	'id,title,intent_type,source_label,deadline,routing_summary,state,version,created_at,updated_at'

function timestamp(value: unknown): string {
	return value instanceof Date ? value.toISOString() : String(value)
}

function summary(row: Record<string, unknown>): IntentSummary {
	return {
		id: String(row.id),
		title: String(row.title),
		intentType: String(row.intent_type),
		sourceLabel: String(row.source_label),
		deadline: row.deadline === null ? null : String(row.deadline),
		routingSummary: String(row.routing_summary),
		state: String(row.state) as IntentState,
		version: Number(row.version),
		sourceArtifactId: null,
		createdAt: timestamp(row.created_at),
		updatedAt: timestamp(row.updated_at)
	}
}

function contribution(row: Record<string, unknown>): Contribution {
	return {
		id: String(row.id),
		sequence: Number(row.sequence),
		contributorKind: String(row.contributor_kind) as Contribution['contributorKind'],
		kind: String(row.kind),
		text: row.text === null ? null : String(row.text),
		payload: row.payload as Record<string, unknown>,
		createdAt: timestamp(row.created_at)
	}
}

async function transaction<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>) {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		const value = await run(client)
		await client.query('COMMIT')
		return value
	} catch (error) {
		await client.query('ROLLBACK').catch(() => {})
		throw error
	} finally {
		client.release()
	}
}

async function insertContribution(
	client: Queryable,
	intentId: string,
	input:
		| ContributionInput
		| (Omit<ContributionInput, 'contributorKind'> & { contributorKind: 'system' }),
	idempotencyKey: string
): Promise<Contribution> {
	const result = await client.query(
		`INSERT INTO contributions
		 (id,intent_id,sequence,contributor_kind,kind,text,payload,idempotency_key)
		 VALUES($1,$2,(SELECT COALESCE(max(sequence),0)+1 FROM contributions WHERE intent_id=$2),$3,$4,$5,$6,$7)
		 RETURNING id,sequence,contributor_kind,kind,text,payload,created_at`,
		[
			input.id,
			intentId,
			input.contributorKind,
			input.kind,
			input.text,
			input.payload,
			idempotencyKey
		]
	)
	return contribution(result.rows[0])
}

export class IntentStore {
	constructor(readonly pool: pg.Pool) {}

	async page(subjectId: string, input: RetrievalInput) {
		const searching = Boolean(input.query?.trim())
		const page = retrievalPage(subjectId, input, searching ? 'intent-search' : 'intent-recent')
		if (page.after && !searching && !page.after.updated)
			throw new InvalidRetrievalCursor('Missing page timestamp')
		const values: unknown[] = [subjectId]
		const conditions = ['owner_subject_id=$1', "state NOT IN ('merged','deleted')"]
		if (input.state === 'archive') conditions.push("state='archive'")
		if (input.state === 'active') conditions.push("state<>'archive'")
		if (searching) {
			values.push(page.query)
			conditions.push(
				`search_vector @@ plainto_tsquery('simple',aven_intents.search_normalize($${values.length}))`
			)
		}
		if (page.after) {
			values.push(page.after.id)
			if (searching) conditions.push(`id>$${values.length}::uuid`)
			else {
				values.push(page.after.updated)
				conditions.push(
					`(updated_at,id)<($${values.length}::timestamptz,$${values.length - 1}::uuid)`
				)
			}
		}

		if (searching) {
			// An unordered bounded probe avoids PostgreSQL's optimistic ordered-index
			// plan scanning the entire history for a rare/absent term under LIMIT.
			const candidates = await this.pool.query(
				`SELECT id FROM intents WHERE ${conditions.join(' AND ')} LIMIT 2001`,
				values
			)
			if (candidates.rows.length <= 2000) {
				values.push(candidates.rows.map((r) => r.id))
				conditions.push(`id=ANY($${values.length}::uuid[])`)
			}
		}
		values.push(page.size + 1)
		const result = await this.pool.query(
			`SELECT ${intentColumns},updated_at::text AS cursor_updated
			FROM intents WHERE ${conditions.join(' AND ')} ORDER BY ${searching ? 'id' : 'updated_at DESC,id DESC'} LIMIT $${values.length}`,
			values
		)
		const rows = result.rows.slice(0, page.size)
		const last = rows.at(-1)
		return {
			intents: rows.map(summary),
			hasMore: result.rows.length > page.size,
			nextCursor:
				result.rows.length > page.size && last
					? page.cursor({ id: last.id, ...(!searching && { updated: last.cursor_updated }) })
					: null,
			matchMode: searching ? 'all-terms' : 'recent'
		}
	}

	async messages(subjectId: string, input: RetrievalInput) {
		const history = Boolean(input.intent) && !input.query?.trim()
		const page = retrievalPage(
			subjectId,
			{ ...input, limit: Math.min(input.limit ?? 20, 20) },
			history ? 'message-history' : 'message-search'
		)
		if (history && page.after && !page.after.sequence)
			throw new InvalidRetrievalCursor('Missing message sequence')
		const values: unknown[] = [subjectId]
		const conditions = [
			'c.owner_subject_id=$1',
			'i.owner_subject_id=$1',
			"i.state NOT IN ('merged','deleted')",
			"c.contributor_kind IN ('human','agent')",
			'c.text IS NOT NULL'
		]
		if (input.intent) {
			values.push(input.intent)
			conditions.push(`c.intent_id=$${values.length}::uuid`)
		}
		if (input.state === 'archive') conditions.push("i.state='archive'")
		if (input.state === 'active') conditions.push("i.state<>'archive'")
		let queryIndex = 0
		if (page.query) {
			values.push(page.query)
			queryIndex = values.length
			conditions.push(
				`c.search_vector @@ plainto_tsquery('simple',aven_intents.search_normalize($${queryIndex}))`
			)
		}
		if (page.after) {
			values.push(history ? page.after.sequence : page.after.id)
			conditions.push(history ? `c.sequence<$${values.length}` : `c.id>$${values.length}::uuid`)
		}

		if (page.query) {
			const candidates = await this.pool.query(
				`SELECT c.id FROM contributions c JOIN intents i ON i.id=c.intent_id WHERE ${conditions.join(' AND ')} LIMIT 2001`,
				values
			)
			if (candidates.rows.length <= 2000) {
				values.push(candidates.rows.map((r) => r.id))
				conditions.push(`c.id=ANY($${values.length}::uuid[])`)
			}
		}
		values.push(page.size + 1)
		const excerpt = queryIndex
			? `ts_headline('simple',c.text,plainto_tsquery('simple',aven_intents.search_normalize($${queryIndex})),'StartSel="", StopSel="", MaxWords=70, MinWords=20, MaxFragments=1')`
			: 'c.text'
		const result = await this.pool.query(
			`SELECT c.id,c.intent_id,c.sequence,c.contributor_kind,c.created_at,
			left(${excerpt},700) AS content,char_length(c.text) AS total_chars FROM contributions c JOIN intents i ON i.id=c.intent_id
			WHERE ${conditions.join(' AND ')} ORDER BY ${history ? 'c.sequence DESC' : 'c.id'} LIMIT $${values.length}`,
			values
		)
		const rows = result.rows.slice(0, page.size),
			last = rows.at(-1)
		return {
			messages: rows.map((r) => ({
				id: r.id,
				intentId: r.intent_id,
				sequence: r.sequence,
				role: r.contributor_kind === 'human' ? 'user' : 'assistant',
				content: r.content,
				createdAt: timestamp(r.created_at),
				hasMoreText: r.total_chars > 700
			})),
			hasMore: result.rows.length > page.size,
			nextCursor:
				result.rows.length > page.size && last
					? page.cursor({ id: last.id, ...(history && { sequence: Number(last.sequence) }) })
					: null,
			matchMode: page.query ? 'all-terms' : history ? 'recent' : 'id-order',
			notice:
				'Use message_detail for complete original text. Search covers stored human and agent messages, including archived Intents.'
		}
	}

	async message(subjectId: string, id: string, offset = 0) {
		const result = await this.pool.query(
			`SELECT c.id,c.intent_id,c.contributor_kind,c.created_at,substring(c.text FROM $3+1 FOR 12000) AS content,char_length(c.text) AS total_chars
			FROM contributions c JOIN intents i ON i.id=c.intent_id WHERE c.id=$2 AND c.owner_subject_id=$1 AND i.owner_subject_id=$1
			AND i.state NOT IN ('merged','deleted') AND c.contributor_kind IN ('human','agent') AND c.text IS NOT NULL`,
			[subjectId, id, offset]
		)
		const row = result.rows[0]
		if (!row) throw new IntentNotFoundError('Message not found')
		if (offset > row.total_chars)
			throw new InvalidRetrievalCursor('Message offset exceeds its length')
		return {
			id: row.id,
			intentId: row.intent_id,
			createdAt: timestamp(row.created_at),
			role: row.contributor_kind === 'human' ? 'user' : 'assistant',
			content: row.content,
			offset,
			totalChars: row.total_chars,
			nextOffset: offset + 12000 < row.total_chars ? offset + 12000 : null
		}
	}

	async ready(): Promise<void> {
		const result = await this.pool.query(
			`SELECT 1 FROM aven_platform.component_installations
			 WHERE component_ref='ceo.aven:component:data:intents@1'
			 AND schema_version=1`
		)
		if (result.rowCount !== 1) throw new Error('Intent Service migration is not applied.')
	}

	async detail(subjectId: string, intentId: string): Promise<IntentDetail> {
		const intent = await this.pool.query(
			`SELECT ${intentColumns} FROM intents
			 WHERE owner_subject_id=$1 AND id=$2 AND state<>'deleted'`,
			[subjectId, intentId]
		)
		if (!intent.rows[0]) throw new IntentNotFoundError('Intent not found.')
		const contributions = await this.pool.query(
			`SELECT id,sequence,contributor_kind,kind,text,payload,created_at
			 FROM contributions WHERE intent_id=$1 ORDER BY sequence DESC LIMIT 41`,
			[intentId]
		)
		return {
			...summary(intent.rows[0]),
			contributions: contributions.rows.slice(0, 40).reverse().map(contribution),
			contributionsHasMore: contributions.rows.length > 40,
			artifacts: [],
			fileSkill: null
		}
	}

	async create(subjectId: string, input: CreateIntent): Promise<IntentDetail> {
		const routingSummary = input.routingSummary?.trim() || `Intent: ${input.title.trim()}`
		const inserted = await transaction(this.pool, async (client) => {
			const result = await client.query(
				`INSERT INTO intents
				 (id,owner_subject_id,trigger_kind,title,intent_type,source_label,deadline,routing_summary)
				 VALUES($1,$2,'human',$3,$4,$5,$6,$7)
				 ON CONFLICT(id) DO NOTHING`,
				[
					input.id,
					subjectId,
					input.title.trim(),
					input.intentType.trim(),
					input.sourceLabel.trim(),
					input.deadline?.trim() || null,
					routingSummary
				]
			)
			if (result.rowCount === 0) return false
			await insertContribution(
				client,
				input.id,
				{
					id: randomUUID(),
					contributorKind: 'system',
					kind: 'intent-created',
					text: null,
					payload: { triggerKind: 'human' }
				},
				`create:${input.id}`
			)
			return true
		})
		if (!inserted) {
			const existing = await this.detail(subjectId, input.id).catch(() => null)
			if (
				!existing ||
				existing.title !== input.title.trim() ||
				existing.intentType !== input.intentType.trim() ||
				existing.sourceLabel !== input.sourceLabel.trim() ||
				existing.deadline !== (input.deadline?.trim() || null) ||
				existing.routingSummary !== routingSummary
			)
				throw new IntentConflictError('Intent ID conflicts with another request.')
			return existing
		}
		return this.detail(subjectId, input.id)
	}

	async append(
		subjectId: string,
		intentId: string,
		input: ContributionInput
	): Promise<Contribution> {
		return transaction(this.pool, async (client) => {
			const owned = await client.query(
				`SELECT true FROM intents
				 WHERE owner_subject_id=$1 AND id=$2 AND state NOT IN ('merged','deleted') FOR UPDATE`,
				[subjectId, intentId]
			)
			if (!owned.rows[0]) throw new IntentNotFoundError('Intent not found.')
			const existing = await client.query(
				`SELECT id,intent_id,sequence,contributor_kind,kind,text,payload,created_at
				 FROM contributions WHERE id=$1 OR (intent_id=$2 AND idempotency_key=$3)
				 LIMIT 1 FOR UPDATE`,
				[input.id, intentId, input.id]
			)
			if (existing.rows[0]) {
				const row = existing.rows[0]
				if (
					String(row.intent_id) !== intentId ||
					String(row.contributor_kind) !== input.contributorKind ||
					String(row.kind) !== input.kind ||
					(row.text === null ? null : String(row.text)) !== input.text ||
					!isDeepStrictEqual(row.payload, input.payload)
				)
					throw new IntentConflictError('Contribution ID conflicts with another request.')
				return contribution(row)
			}
			const created = await insertContribution(client, intentId, input, input.id)
			await client.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[intentId]
			)
			return created
		})
	}

	async update(subjectId: string, intentId: string, input: UpdateIntent): Promise<IntentDetail> {
		const result = await this.pool.query(
			`UPDATE intents SET
			 title=COALESCE($4,title),intent_type=COALESCE($5,intent_type),
			 source_label=COALESCE($6,source_label),
			 deadline=CASE WHEN $7 THEN NULL WHEN $8::text IS NOT NULL THEN $8 ELSE deadline END,
			 routing_summary=COALESCE($9,routing_summary),state=COALESCE($10,state),
			 version=version+1,updated_at=clock_timestamp()
			 WHERE owner_subject_id=$1 AND id=$2 AND version=$3 AND state NOT IN ('merged','deleted')`,
			[
				subjectId,
				intentId,
				input.expectedVersion,
				input.title?.trim() || null,
				input.intentType?.trim() || null,
				input.sourceLabel?.trim() || null,
				input.clearDeadline,
				input.deadline?.trim() || null,
				input.routingSummary?.trim() || null,
				input.state ?? null
			]
		)
		if (result.rowCount !== 1) throw new IntentConflictError('Intent version or state changed.')
		return this.detail(subjectId, intentId)
	}

	async archiveOrRestore(
		subjectId: string,
		intentId: string,
		input: VersionCommand,
		restore: boolean
	): Promise<IntentDetail> {
		if (input.id !== intentId) throw new IntentConflictError('Intent ID does not match the path.')
		const query = restore
			? `UPDATE intents SET state=COALESCE(state_before_archive,'working'),state_before_archive=NULL,
			   version=version+1,updated_at=clock_timestamp()
			   WHERE owner_subject_id=$1 AND id=$2 AND version=$3 AND state='archive'`
			: `UPDATE intents SET state_before_archive=state,state='archive',
			   version=version+1,updated_at=clock_timestamp()
			   WHERE owner_subject_id=$1 AND id=$2 AND version=$3
			   AND state IN ('working','waiting','done','error')`
		const result = await this.pool.query(query, [subjectId, intentId, input.expectedVersion])
		if (result.rowCount !== 1) throw new IntentConflictError('Intent version or state changed.')
		return this.detail(subjectId, intentId)
	}

	async tombstone(subjectId: string, intentId: string, input: VersionCommand): Promise<void> {
		if (input.id !== intentId) throw new IntentConflictError('Intent ID does not match the path.')
		const result = await this.pool.query(
			`UPDATE intents SET state='deleted',version=version+1,updated_at=clock_timestamp()
			 WHERE owner_subject_id=$1 AND id=$2 AND version=$3 AND state NOT IN ('merged','deleted')`,
			[subjectId, intentId, input.expectedVersion]
		)
		if (result.rowCount !== 1) throw new IntentConflictError('Intent version or state changed.')
	}

	async merge(subjectId: string, targetId: string, input: MergeCommand): Promise<IntentDetail> {
		if (input.id !== targetId || input.sources.some((source) => source.id === targetId))
			throw new IntentConflictError('Intent merge is invalid.')
		const sourceVersions = new Map(
			input.sources.map((source) => [source.id, source.expectedVersion])
		)
		if (sourceVersions.size !== input.sources.length)
			throw new IntentConflictError('Intent merge contains duplicate sources.')
		const sources = [...sourceVersions.keys()].sort()
		return transaction(this.pool, async (client) => {
			const prior = await client.query(
				`SELECT target_intent_id,target_version,source_versions
				 FROM merge_commands WHERE command_id=$1 FOR UPDATE`,
				[input.commandId]
			)
			if (prior.rows[0]) {
				const row = prior.rows[0]
				const expectedSources = Object.fromEntries(
					[...sourceVersions.entries()].sort(([left], [right]) => left.localeCompare(right))
				)
				if (
					String(row.target_intent_id) !== targetId ||
					Number(row.target_version) !== input.expectedVersion ||
					!isDeepStrictEqual(row.source_versions, expectedSources)
				)
					throw new IntentConflictError('Merge command ID conflicts with another request.')
				return this.detailWith(client, subjectId, targetId)
			}
			const ids = [targetId, ...sources].sort()
			const locked = await client.query(
				`SELECT id,version,state FROM intents
				 WHERE owner_subject_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`,
				[subjectId, ids]
			)
			if (locked.rows.length !== ids.length)
				throw new IntentConflictError('One or more intents do not exist.')
			const target = locked.rows.find((row) => String(row.id) === targetId)
			if (
				!target ||
				Number(target.version) !== input.expectedVersion ||
				['merged', 'deleted'].includes(String(target.state)) ||
				locked.rows.some(
					(row) =>
						String(row.id) !== targetId &&
						(Number(row.version) !== sourceVersions.get(String(row.id)) ||
							['merged', 'deleted'].includes(String(row.state)))
				)
			)
				throw new IntentConflictError('Intent version or state changed.')
			await client.query(
				`INSERT INTO merge_commands(command_id,target_intent_id,target_version,source_versions)
				 VALUES($1,$2,$3,$4)`,
				[
					input.commandId,
					targetId,
					input.expectedVersion,
					Object.fromEntries(
						[...sourceVersions.entries()].sort(([left], [right]) => left.localeCompare(right))
					)
				]
			)
			for (const sourceId of sources) {
				await client.query(
					`INSERT INTO merge_relations(target_intent_id,source_intent_id,command_id)
					 VALUES($1,$2,$3)`,
					[targetId, sourceId, input.commandId]
				)
				await client.query(
					`UPDATE intents SET state='merged',merged_into_id=$1,version=version+1,
					 updated_at=clock_timestamp() WHERE id=$2`,
					[targetId, sourceId]
				)
			}
			await insertContribution(
				client,
				targetId,
				{
					id: randomUUID(),
					contributorKind: 'system',
					kind: 'intents-merged',
					text: null,
					payload: { sourceIntentIds: sources, commandId: input.commandId }
				},
				input.commandId
			)
			await client.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[targetId]
			)
			return this.detailWith(client, subjectId, targetId)
		})
	}

	private async detailWith(
		client: Queryable,
		subjectId: string,
		intentId: string
	): Promise<IntentDetail> {
		const intent = await client.query(
			`SELECT ${intentColumns} FROM intents
			 WHERE owner_subject_id=$1 AND id=$2 AND state<>'deleted'`,
			[subjectId, intentId]
		)
		if (!intent.rows[0]) throw new IntentNotFoundError('Intent not found.')
		const contributions = await client.query(
			`SELECT id,sequence,contributor_kind,kind,text,payload,created_at
			 FROM contributions WHERE intent_id=$1 ORDER BY sequence DESC LIMIT 41`,
			[intentId]
		)
		return {
			...summary(intent.rows[0]),
			contributions: contributions.rows.slice(0, 40).reverse().map(contribution),
			contributionsHasMore: contributions.rows.length > 40,
			artifacts: [],
			fileSkill: null
		}
	}
}
