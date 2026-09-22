import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { customerComponentCatalog } from '@avenos/aven-customer-contracts'
import {
	type AdmissionReceipt,
	admissionDigest,
	type InputAdmission,
	inputAdmissionSchema
} from '@avenos/intents/admission'
import { readFeedbackCheck } from '@avenos/intents/feedback'
import {
	HISTORY_PREVIEW_CHARS,
	HISTORY_PREVIEW_MESSAGES,
	intentHistoryPreview,
	messageRetrievalSchema
} from '@avenos/intents/retrieval'
import {
	type TurnPageInput,
	type TurnStopCommand,
	turnPageInputSchema,
	turnPageSchema,
	turnStatusSchema,
	turnStopCommandSchema,
	turnStopReceiptSchema
} from '@avenos/intents/turn-status'
import pg from 'pg'
import {
	feedbackAssessmentSchema,
	feedbackCheckProjection,
	feedbackContributionSchema,
	feedbackProjection,
	type ResponseFeedback
} from './feedback.js'
import { ReplacementHistoryError, replacementHistory } from './replacement-history.js'
import { InvalidRetrievalCursor, type RetrievalInput, retrievalPage } from './retrieval.js'
import type { AdmissionWorkAuthority } from './work-authority.js'

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
	feedback?: ResponseFeedback | null
	feedbackCheckComplete?: boolean
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

function admissionReceipt(row: Record<string, unknown>): AdmissionReceipt {
	return {
		inputId: String(row.input_id),
		revision: Number(row.revision),
		contributionId: String(row.contribution_id),
		intentId: String(row.intent_id),
		intentTitle: String(row.intent_title),
		turnId: String(row.turn_id),
		sequence: Number(row.sequence),
		admittedAt: timestamp(row.admitted_at)
	}
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
		feedback: (row.feedback ?? null) as ResponseFeedback | null,
		feedbackCheckComplete: row.feedback_check_complete === true,
		createdAt: timestamp(row.created_at)
	}
}

export async function transaction<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>) {
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

export async function insertContribution(
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

	/** No model or cross-service calls inside the atomic customer-local boundary. */
	async admit(
		subjectId: string,
		request: InputAdmission,
		routingGeneration: number,
		authority: AdmissionWorkAuthority
	): Promise<AdmissionReceipt> {
		const input = inputAdmissionSchema.parse(request)
		if (!Number.isSafeInteger(routingGeneration) || routingGeneration < 1)
			throw new IntentConflictError('Invalid routing generation.')
		const digest = await admissionDigest(input)
		if (
			authority.claims.sub !== subjectId ||
			authority.claims.routingGeneration !== routingGeneration ||
			authority.claims.inputId !== input.inputId ||
			authority.claims.inputRevision !== input.revision ||
			authority.claims.materialDigest !== digest
		)
			throw new IntentConflictError('Work authority does not match this message.')
		return transaction(this.pool, async (client) => {
			// Serializes even the first attempt, including two clients creating a new Intent.
			await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
				`input-admission:${subjectId}:${input.inputId}`
			])
			const prior = await client.query(
				`SELECT * FROM input_admissions
				WHERE owner_subject_id=$1 AND input_id=$2`,
				[subjectId, input.inputId]
			)
			if (prior.rows[0]) {
				if (
					Number(prior.rows[0].revision) !== input.revision ||
					prior.rows[0].material_digest !== digest
				)
					throw new IntentConflictError(
						'This input was already sent with different material. Resolve its receipt before editing.'
					)
				return admissionReceipt(prior.rows[0])
			}
			const active = await client.query(
				`SELECT 1 FROM aven_platform.environment_identity
				WHERE singleton AND environment_id=$1 AND routing_generation=$2 AND execution_enabled`,
				[authority.claims.environmentId, routingGeneration]
			)
			if (active.rowCount !== 1 || authority.claims.exp <= Math.floor(Date.now() / 1000))
				throw new IntentConflictError(
					'This workspace changed or work is paused. Your message was not sent; reconnect before trying again.'
				)
			const intentId = input.target.kind === 'new' ? randomUUID() : input.target.id
			if (input.target.kind === 'new') {
				await client.query(
					`INSERT INTO intents
					(id,owner_subject_id,trigger_kind,title,intent_type,source_label,routing_summary)
					VALUES($1,$2,'human',$3,'intent','Conversation',$3)`,
					[intentId, subjectId, input.target.title]
				)
				await insertContribution(
					client,
					intentId,
					{
						id: randomUUID(),
						contributorKind: 'system',
						kind: 'intent-created',
						text: null,
						payload: { triggerKind: 'human', inputId: input.inputId }
					},
					`create:${intentId}`
				)
			}
			const target = await client.query(
				`SELECT title FROM intents WHERE id=$1 AND owner_subject_id=$2
				AND state IN ('working','waiting','done','error') FOR UPDATE`,
				[intentId, subjectId]
			)
			if (!target.rows[0])
				throw new IntentNotFoundError(
					'The destination is no longer available. Your message was not sent.'
				)
			let replaced: { turn_id: string; queue_position?: string; queue_revision: number } | undefined
			if (input.replaces) {
				const priorTurn = (
					await client.query(
						`SELECT turn_id,state,run_id,control_revision,queue_position,queue_revision
					 FROM turn_outbox WHERE turn_id=$1 AND intent_id=$2 AND owner_subject_id=$3
					 AND routing_generation=$4 FOR UPDATE`,
						[input.replaces.turnId, intentId, subjectId, routingGeneration]
					)
				).rows[0]
				if (!priorTurn)
					throw new IntentNotFoundError('The message to edit is not available in this Intent.')
				if (Number(priorTurn.control_revision) !== input.replaces.expectedControlRevision)
					throw new IntentConflictError('This message changed. Refresh before saving the edit.')
				if (
					(
						await client.query('SELECT 1 FROM turn_outbox WHERE replaces_turn_id=$1', [
							priorTurn.turn_id
						])
					).rowCount
				)
					throw new IntentConflictError(
						'This message was already replaced. Edit its latest version.'
					)
				try {
					await replacementHistory(
						client,
						{ subjectId, intentId, generation: routingGeneration },
						priorTurn.turn_id,
						false
					)
				} catch (error) {
					if (error instanceof ReplacementHistoryError) throw new IntentConflictError(error.message)
					throw error
				}
				// If completion won the race, append after existing work. Reusing an old
				// slot could overtake a newer, already-running request in this Intent.
				const ended = ['completed', 'failed', 'cancelled'].includes(priorTurn.state)
				replaced = {
					...priorTurn,
					queue_position: ended ? undefined : priorTurn.queue_position,
					queue_revision: ended ? 0 : priorTurn.queue_revision
				}
			}
			const turnId = randomUUID()
			const created = await insertContribution(
				client,
				intentId,
				{
					id: randomUUID(),
					contributorKind: 'human',
					kind: 'message',
					text: input.text,
					payload: {
						inputAdmission: {
							inputId: input.inputId,
							revision: input.revision,
							intentId,
							turnId,
							destination: input.target.kind,
							confirmed: input.confirmed,
							...(input.replaces && { replacesTurnId: input.replaces.turnId }),
							...(input.sourceContext && { sourceContext: input.sourceContext }),
							...(input.responseMode && { responseMode: input.responseMode })
						},
						...(input.speaker && { anonymousSpeaker: input.speaker }),
						...(input.feedbackCheck && { feedbackCheck: input.feedbackCheck }),
						locale: input.locale,
						timezone: input.timezone,
						capturedAt: input.capturedAt,
						references: input.references
					}
				},
				`input:${input.inputId}:${input.revision}`
			)
			const admitted = await client.query(
				`INSERT INTO input_admissions
				(owner_subject_id,input_id,revision,material_digest,intent_id,contribution_id,turn_id,sequence,intent_title)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
				[
					subjectId,
					input.inputId,
					input.revision,
					digest,
					intentId,
					created.id,
					turnId,
					created.sequence,
					target.rows[0].title
				]
			)
			await client.query(
				`INSERT INTO turn_outbox(turn_id,intent_id,owner_subject_id,sequence,input,routing_generation,work_grant,authority_expires_at,output_id,queue_position,queue_revision,replaces_turn_id)
				VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),$9,$10,$11,$12)`,
				[
					turnId,
					intentId,
					subjectId,
					created.sequence,
					input,
					routingGeneration,
					authority.token,
					authority.claims.exp,
					randomUUID(),
					replaced?.queue_position ?? created.sequence,
					replaced ? replaced.queue_revision + 1 : 1,
					replaced?.turn_id ?? null
				]
			)
			if (replaced)
				await client.query(
					`UPDATE turn_outbox SET
					state=CASE WHEN state IN ('completed','failed','cancelled') THEN state WHEN run_id IS NULL THEN 'cancelled' ELSE 'blocked' END,
					control_revision=control_revision+1,
					stop_requested_at=CASE WHEN state IN ('completed','failed','cancelled') THEN stop_requested_at ELSE COALESCE(stop_requested_at,clock_timestamp()) END,
					finished_at=CASE WHEN state IN ('completed','failed','cancelled') OR run_id IS NOT NULL THEN finished_at ELSE clock_timestamp() END,
					error_code=CASE WHEN state IN ('completed','failed','cancelled') OR error_code='EXECUTION_UNCERTAIN' THEN error_code ELSE 'INPUT_REPLACED' END,
					dispatch_token=NULL,dispatch_until=NULL,available_at=clock_timestamp() WHERE turn_id=$1`,
					[replaced.turn_id]
				)
			await client.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[intentId]
			)
			return admissionReceipt(admitted.rows[0])
		})
	}

	async admission(subjectId: string, inputId: string, revision: number): Promise<AdmissionReceipt> {
		const found = await this.pool.query(
			`SELECT a.* FROM input_admissions a JOIN intents i ON i.id=a.intent_id
			WHERE a.owner_subject_id=$1 AND i.owner_subject_id=$1 AND a.input_id=$2`,
			[subjectId, inputId]
		)
		if (!found.rows[0]) throw new IntentNotFoundError('Input receipt not found.')
		if (Number(found.rows[0].revision) !== revision)
			throw new IntentConflictError(
				'Another revision of this input was already sent. Resolve its receipt before editing.'
			)
		return admissionReceipt(found.rows[0])
	}

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
		input = messageRetrievalSchema.parse(input)
		const history = Boolean(input.intent)
		const oldest = input.order === 'oldest'
		const ordering = history ? `sequence ${oldest ? 'ASC' : 'DESC'}` : 'id'
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
			"c.kind = 'message'",
			'c.text IS NOT NULL'
		]
		if (input.intent) {
			values.push(input.intent)
			conditions.push(`c.intent_id=$${values.length}::uuid`)
		}
		if (input.role) {
			values.push(input.role === 'user' ? 'human' : 'agent')
			conditions.push(`c.contributor_kind=$${values.length}`)
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
			conditions.push(
				history
					? `c.sequence${oldest ? '>' : '<'}$${values.length}`
					: `c.id>$${values.length}::uuid`
			)
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
			`WITH page AS MATERIALIZED (
			SELECT c.id,c.intent_id,c.sequence,c.contributor_kind,c.created_at,${feedbackProjection},
			c.text,${excerpt} AS excerpt,char_length(c.text) AS total_chars
			FROM contributions c JOIN intents i ON i.id=c.intent_id
			WHERE ${conditions.join(' AND ')} ORDER BY c.${ordering} LIMIT $${values.length}
			), located AS (
			SELECT *,CASE WHEN total_chars<=700 THEN 0 ELSE greatest(strpos(text,excerpt)-1,0) END AS read_offset FROM page
			)
			SELECT id,intent_id,sequence,contributor_kind,created_at,feedback,total_chars,read_offset,
			substring(text FROM read_offset+1 FOR 700) AS content FROM located
			ORDER BY ${ordering}`,
			values
		)
		const rows = result.rows.slice(0, page.size),
			last = rows.at(-1)
		return {
			messages: rows.map((r) => ({
				id: r.id,
				sourceId: r.id,
				intentId: r.intent_id,
				sequence: r.sequence,
				role: r.contributor_kind === 'human' ? 'user' : 'assistant',
				content: r.content,
				// Headline generation can remove markup. Only locate a verbatim fragment;
				// otherwise show/read the original first page. Offsets are SQL code points,
				// never positions in normalized text or JavaScript UTF-16 strings.
				readOffset: r.read_offset,
				offset: r.read_offset,
				nextOffset:
					r.read_offset + Array.from(r.content as string).length < r.total_chars
						? r.read_offset + Array.from(r.content as string).length
						: null,
				totalChars: r.total_chars,
				createdAt: timestamp(r.created_at),
				feedback: r.feedback ?? null,
				hasMoreText: r.total_chars > 700
			})),
			hasMore: result.rows.length > page.size,
			nextCursor:
				result.rows.length > page.size && last
					? page.cursor({ id: last.id, ...(history && { sequence: Number(last.sequence) }) })
					: null,
			matchMode: page.query ? 'all-terms' : history ? (oldest ? 'oldest' : 'recent') : 'id-order',
			ordering: history ? (oldest ? 'oldest' : 'newest') : 'id',
			role: input.role ?? 'all',
			notice:
				'Message excerpts with sourceId and offset are exact quotation evidence for the displayed range only. Use message_detail with the message ID and nextOffset for following text, or offset zero for earlier context. Search covers stored human and agent messages, including archived Intents; a matching excerpt does not establish the whole conversation.'
		}
	}

	async message(subjectId: string, id: string, offset = 0) {
		const result = await this.pool.query(
			`SELECT c.id,c.intent_id,c.contributor_kind,c.created_at,${feedbackProjection},${feedbackCheckProjection},substring(c.text FROM $3+1 FOR 12000) AS content,char_length(c.text) AS total_chars
			FROM contributions c JOIN intents i ON i.id=c.intent_id WHERE c.id=$2 AND c.owner_subject_id=$1 AND i.owner_subject_id=$1
			AND i.state NOT IN ('merged','deleted') AND c.contributor_kind IN ('human','agent') AND c.kind<>'response-feedback' AND c.text IS NOT NULL`,
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
			feedback: row.feedback ?? null,
			feedbackCheckComplete: row.feedback_check_complete === true,
			role: row.contributor_kind === 'human' ? 'user' : 'assistant',
			content: row.content,
			offset,
			totalChars: row.total_chars,
			nextOffset: offset + 12000 < row.total_chars ? offset + 12000 : null
		}
	}

	async ready(): Promise<void> {
		const component = customerComponentCatalog.find(
			(c) => c.componentRef === 'ceo.aven:component:data:intents@1'
		)!
		const result = await this.pool.query(
			`SELECT 1 FROM aven_platform.component_installations
			 WHERE component_ref=$1 AND schema_version=$2 AND migration_set_digest=$3`,
			[component.componentRef, component.targetSchemaVersion, component.migrationSetDigest]
		)
		if (result.rowCount !== 1) throw new Error('Intent Service migration is not applied.')
	}

	async detail(subjectId: string, intentId: string): Promise<IntentDetail> {
		return this.detailWith(this.pool, subjectId, intentId)
	}

	/** Withdraw permission first, without pretending that an admitted effect was
	 * undone. Bound work keeps FIFO until the runner's effects are reconciled.
	 * The immutable control receipt makes retries safe even after later controls.
	 */
	async stopTurn(
		subjectId: string,
		intentId: string,
		turnId: string,
		generation: number,
		value: TurnStopCommand
	) {
		const command = turnStopCommandSchema.parse(value)
		return transaction(this.pool, async (db) => {
			const owned = await db.query(
				`SELECT id FROM intents WHERE id=$1 AND owner_subject_id=$2
				AND state<>'deleted' FOR UPDATE`,
				[intentId, subjectId]
			)
			if (!owned.rowCount) throw new IntentNotFoundError('Intent not found.')
			const key = `turn-stop:${turnId}:${command.commandId}`
			const prior = await db.query(
				`SELECT payload FROM contributions WHERE intent_id=$1
				AND contributor_kind='system' AND kind='turn-stop-requested' AND idempotency_key=$2`,
				[intentId, key]
			)
			if (prior.rows[0]) {
				if (!isDeepStrictEqual(prior.rows[0].payload.command, command))
					throw new IntentConflictError(
						'This stop command was already used with different material.'
					)
				return turnStopReceiptSchema.parse(prior.rows[0].payload.receipt)
			}
			const found = await db.query(
				`SELECT state,run_id,control_revision,stop_requested_at FROM turn_outbox
				WHERE turn_id=$1 AND intent_id=$2 AND owner_subject_id=$3 FOR UPDATE`,
				[turnId, intentId, subjectId]
			)
			const row = found.rows[0]
			if (!row) throw new IntentNotFoundError('Turn not found.')
			// Stopping old-generation work is allowed after a move. It cannot issue
			// authority, and unlike admission remains possible while work is paused.
			const current = await db.query(
				`SELECT 1 FROM aven_platform.environment_identity
				WHERE singleton AND routing_generation=$1`,
				[generation]
			)
			if (!current.rowCount)
				throw new IntentConflictError('This workspace changed. Refresh before stopping work.')
			if (Number(row.control_revision) !== command.expectedControlRevision)
				throw new IntentConflictError(
					'Work controls changed. Refresh before stopping this response.'
				)
			const terminal = ['completed', 'failed', 'cancelled'].includes(row.state)
			const disposition = terminal
				? row.state === 'cancelled'
					? 'cancelled'
					: 'finished'
				: row.run_id
					? 'stopping'
					: 'cancelled'
			if (!terminal && !row.stop_requested_at) {
				const changed = await db.query(
					`UPDATE turn_outbox SET
					state=CASE WHEN run_id IS NULL THEN 'cancelled' ELSE 'blocked' END,
					control_revision=control_revision+1,stop_requested_at=COALESCE(stop_requested_at,clock_timestamp()),
					error_code=CASE WHEN error_code='EXECUTION_UNCERTAIN' THEN error_code ELSE 'USER_STOP_REQUESTED' END,
					dispatch_token=NULL,dispatch_until=NULL,available_at=clock_timestamp(),
					finished_at=CASE WHEN run_id IS NULL THEN clock_timestamp() ELSE finished_at END
					WHERE turn_id=$1 RETURNING control_revision,stop_requested_at`,
					[turnId]
				)
				Object.assign(row, changed.rows[0])
			}
			const receipt = turnStopReceiptSchema.parse({
				turnId,
				intentId,
				controlRevision: row.control_revision,
				disposition,
				stopRequestedAt: row.stop_requested_at ? timestamp(row.stop_requested_at) : null
			})
			await insertContribution(
				db,
				intentId,
				{
					id: randomUUID(),
					contributorKind: 'system',
					kind: 'turn-stop-requested',
					text: null,
					payload: { command, receipt }
				},
				key
			)
			await db.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[intentId]
			)
			return receipt
		})
	}

	/** Bounded queue state, without loading prompts, work grants, errors or journals.
	 * "Accepted" only acknowledges dispatch; runner liveness must not be inferred.
	 */
	async turns(subjectId: string, intentId: string, generation: number, input: TurnPageInput = {}) {
		const page = retrievalPage(
			subjectId,
			{ ...turnPageInputSchema.parse(input), intent: intentId },
			`turns:${generation}`
		)
		if (page.after && (!page.after.sequence || page.after.updated))
			throw new InvalidRetrievalCursor('Invalid turn cursor.')
		const owned = await this.pool.query(
			`SELECT 1 FROM intents WHERE id=$1 AND owner_subject_id=$2 AND state<>'deleted'`,
			[intentId, subjectId]
		)
		if (!owned.rowCount) throw new IntentNotFoundError('Intent not found.')
		const result = await this.pool.query(
			`SELECT t.turn_id,t.intent_id,a.contribution_id,t.output_id AS response_id,t.sequence,t.state,
			t.error_code,t.routing_generation,t.authority_expires_at<=clock_timestamp() AS expired,
			a.admitted_at,t.dispatched_at,t.finished_at,t.control_revision,t.stop_requested_at,
			CASE WHEN t.finish_digest IS NOT NULL THEN t.output_id END AS output_id
			FROM turn_outbox t JOIN input_admissions a USING(turn_id) JOIN intents i ON i.id=t.intent_id
			WHERE t.intent_id=$1 AND t.owner_subject_id=$2 AND i.owner_subject_id=$2 AND i.state<>'deleted'
			AND ($3::bigint IS NULL OR t.sequence<$3) ORDER BY t.sequence DESC LIMIT $4`,
			[intentId, subjectId, page.after?.sequence ?? null, page.size + 1]
		)
		const rows = result.rows.slice(0, page.size)
		const turns = rows.map((row) => {
			const unfinished = ['pending', 'dispatched', 'blocked'].includes(row.state)
			const blocked = unfinished && (Number(row.routing_generation) !== generation || row.expired)
			// Expiry must not hide an uncertain effect: renewal is not reconciliation.
			const reason =
				row.error_code !== null
					? turnStatusSchema.shape.reason.safeParse(row.error_code).success
						? row.error_code
						: 'WORK_INTERRUPTED'
					: unfinished && Number(row.routing_generation) !== generation
						? 'WORKSPACE_CHANGED'
						: unfinished && row.expired
							? 'WORK_AUTHORITY_EXPIRED'
							: null
			return {
				turnId: row.turn_id,
				intentId: row.intent_id,
				contributionId: row.contribution_id,
				responseId: row.response_id,
				controlRevision: Number(row.control_revision),
				stopRequestedAt: row.stop_requested_at ? timestamp(row.stop_requested_at) : null,
				sequence: Number(row.sequence),
				state:
					row.state === 'blocked' && row.stop_requested_at
						? 'stopping'
						: blocked
							? 'blocked'
							: row.state === 'pending'
								? 'queued'
								: row.state === 'dispatched'
									? 'accepted'
									: row.state,
				reason,
				admittedAt: timestamp(row.admitted_at),
				acceptedAt: row.dispatched_at ? timestamp(row.dispatched_at) : null,
				finishedAt: row.finished_at ? timestamp(row.finished_at) : null,
				outputContributionId: row.output_id ?? null
			}
		})
		const hasMore = result.rows.length > page.size,
			last = rows.at(-1)
		return turnPageSchema.parse({
			turns,
			hasMore,
			observedAt: new Date().toISOString(),
			nextCursor:
				hasMore && last ? page.cursor({ id: last.turn_id, sequence: Number(last.sequence) }) : null
		})
	}

	/** History discovery never loads large tool payloads or entire transcripts. */
	async preview(subjectId: string, intentId: string) {
		const intent = await this.pool.query(
			`SELECT id,title,state,source_label FROM intents
			WHERE id=$1 AND owner_subject_id=$2 AND state NOT IN ('merged','deleted')`,
			[intentId, subjectId]
		)
		if (!intent.rows[0]) throw new IntentNotFoundError('Intent not found')
		const [messages, activity] = await Promise.all([
			this.pool.query(
				`SELECT c.id,c.contributor_kind,c.kind,left(c.text,$3) AS text,
				char_length(c.text) AS total_chars,c.created_at,${feedbackProjection}
				FROM contributions c JOIN intents i ON i.id=c.intent_id
				WHERE c.intent_id=$1 AND c.owner_subject_id=$2 AND i.owner_subject_id=$2
				AND i.state NOT IN ('merged','deleted') AND c.kind='message'
				AND c.contributor_kind IN ('human','agent') AND c.text IS NOT NULL
				ORDER BY c.sequence DESC LIMIT $4`,
				[intentId, subjectId, HISTORY_PREVIEW_CHARS, HISTORY_PREVIEW_MESSAGES + 1]
			),
			this.pool.query(
				`SELECT c.id,c.contributor_kind,c.kind,left(c.text,500) AS text,c.created_at
				FROM contributions c JOIN intents i ON i.id=c.intent_id
				WHERE c.intent_id=$1 AND c.owner_subject_id=$2 AND i.owner_subject_id=$2
				AND i.state NOT IN ('merged','deleted') AND c.kind NOT IN ('message','response-feedback','feedback-assessment')
				ORDER BY c.sequence DESC LIMIT 10`,
				[intentId, subjectId]
			)
		])
		return intentHistoryPreview({
			...intent.rows[0],
			sourceLabel: intent.rows[0].source_label,
			contributions: [...activity.rows.reverse(), ...messages.rows.reverse()].map((c) => ({
				id: c.id,
				contributorKind: c.contributor_kind,
				kind: c.kind,
				text: c.text,
				totalChars: c.total_chars,
				createdAt: timestamp(c.created_at),
				feedback: c.feedback
			}))
		})
	}

	/** A narrow provenance check, without loading conversation content. */
	async verifyTaskCause(
		subjectId: string,
		intentId: string,
		contributionId: string | null,
		turnId?: string
	): Promise<void> {
		const result = await this.pool.query(
			`SELECT 1 FROM intents i
			WHERE i.id=$1 AND i.owner_subject_id=$2 AND i.state NOT IN ('merged','deleted')
			AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM contributions c
				WHERE c.id=$3 AND c.intent_id=i.id AND c.owner_subject_id=$2))
			AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM input_admissions a JOIN turn_outbox t USING(turn_id)
				WHERE a.turn_id=$4 AND a.intent_id=i.id AND a.contribution_id=$3 AND a.owner_subject_id=$2
				AND t.state='dispatched' AND t.authority_expires_at>clock_timestamp()))`,
			[intentId, subjectId, contributionId, turnId ?? null]
		)
		if (result.rowCount !== 1) throw new IntentNotFoundError('The task context is not available.')
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
		const feedback =
			input.kind === 'response-feedback' ? feedbackContributionSchema.parse(input).payload : null
		const assessment =
			input.kind === 'feedback-assessment' ? feedbackAssessmentSchema.parse(input).payload : null
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
			if (assessment) {
				const source = await client.query(
					`SELECT payload FROM contributions WHERE id=$1 AND intent_id=$2
					AND owner_subject_id=$3 AND contributor_kind='human' AND kind='message'`,
					[assessment.sourceId, intentId, subjectId]
				)
				if (readFeedbackCheck(source.rows[0]?.payload?.feedbackCheck)?.commandId !== input.id)
					throw new IntentNotFoundError('Feedback check not found.')
			}
			if (feedback) {
				const response = await client.query(
					`SELECT c.id,c.created_at,c.payload,${feedbackProjection} FROM contributions c
					 WHERE c.intent_id=$1 AND c.id=$2 AND c.owner_subject_id=$3
					 AND c.contributor_kind='agent' AND c.kind='message' AND c.text IS NOT NULL`,
					[intentId, feedback.responseId, subjectId]
				)
				if (!response.rows[0]) throw new IntentNotFoundError('Response not found.')
				const current = response.rows[0].feedback as ResponseFeedback | null
				if (feedback.inferredFrom) {
					// The triggering utterance must already be saved in an owned Intent and
					// carry the eligible response scope. No draft or invented source.
					const source = await client.query(
						`SELECT c.payload,c.text,c.created_at>(SELECT created_at FROM contributions WHERE id=$3) AS after_response
						 FROM contributions c JOIN intents i ON i.id=c.intent_id
						 WHERE c.id=$1 AND c.owner_subject_id=$2 AND i.owner_subject_id=$2
						 AND c.contributor_kind='human' AND c.kind='message' AND c.text IS NOT NULL`,
						[feedback.inferredFrom, subjectId, feedback.responseId]
					)
					if (!source.rows[0]) throw new IntentNotFoundError('Feedback source not found.')
					const { payload, text } = source.rows[0]
					const check = readFeedbackCheck(payload.feedbackCheck)
					const target = check?.recent.find(
						(e) => e.role === 'assistant' && e.responseId === feedback.responseId
					)
					const eligible =
						check?.commandId === input.id &&
						check.intentId === intentId &&
						target &&
						typeof feedback.sourceQuote === 'string' &&
						!!feedback.sourceQuote.trim() &&
						text.includes(feedback.sourceQuote)
					if (!eligible) throw new IntentNotFoundError('Feedback source not found.')
					if (!source.rows[0].after_response) {
						// A delivery reaction can precede the finished answer. It must
						// name the exact captured pending reply and an earlier admitted
						// request that this answer actually addresses, in this Intent.
						if (
							!target.pending ||
							!target.requestId ||
							!Array.isArray(response.rows[0].payload?.inReplyTo) ||
							!response.rows[0].payload.inReplyTo.includes(target.requestId)
						)
							throw new IntentNotFoundError('Feedback source not found.')
						const anchor = await client.query(
							`SELECT true FROM contributions WHERE id=$1 AND intent_id=$2
							AND owner_subject_id=$3 AND contributor_kind='human' AND kind='message'
							AND created_at<(SELECT created_at FROM contributions WHERE id=$4)`,
							[target.requestId, intentId, subjectId, feedback.inferredFrom]
						)
						if (!anchor.rows[0]) throw new IntentNotFoundError('Feedback source not found.')
					}
					if (current && !current.inferredFrom)
						throw new IntentConflictError('Manual feedback takes precedence.')
					if (current?.inferredFrom) {
						const previous = await client.query(
							`SELECT true FROM contributions older, contributions newer
							WHERE older.id=$1 AND newer.id=$2 AND newer.created_at>older.created_at`,
							[current.inferredFrom, feedback.inferredFrom]
						)
						if (!previous.rows[0])
							throw new IntentConflictError('Newer feedback has already been recorded.')
					}
				}
				// A deliberate click wins over an automatic vote that arrived meanwhile;
				// two conflicting human edits still require reload.
				if (
					(current?.id ?? null) !== feedback.previousFeedbackId &&
					!(!feedback.inferredFrom && current?.inferredFrom)
				)
					throw new IntentConflictError(
						'Feedback changed elsewhere. Reload the response before editing it.'
					)
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
			`SELECT c.id,c.sequence,c.contributor_kind,c.kind,c.text,c.payload,c.created_at,${feedbackProjection},${feedbackCheckProjection}
			 FROM contributions c WHERE c.intent_id=$1 AND c.kind NOT IN ('response-feedback','feedback-assessment') ORDER BY c.sequence DESC LIMIT 41`,
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
