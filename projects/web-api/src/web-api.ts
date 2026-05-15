import {
	asSqlitePersistence,
	createAppNode,
	type AppNode,
	type CreateAppNodeInput
} from '@jaensen/app-node'
import type { UserAttachment } from '@jaensen/conversation-actors'
import {
	HUMAN_ACTOR_ID,
	createIntentActorId,
	parseActorId,
	parseSkillActorId,
	parseSkillWorkerActorId
} from '@jaensen/persistence-sqlite'
import type {
	ActorHierarchyRecord,
	ActorLogRecord,
	ActorRecord,
	CommunicationTreeRecord,
	CommunicationTreeSummary,
	ContextItemRecord,
	ContextQuery,
	EventRecord,
	EventVisibility,
	SkillRecord
} from '@jaensen/persistence-sqlite'

import {
	AttachmentValidationError,
	createAttachmentStore,
	DEFAULT_ATTACHMENT_ROOT,
	type AttachmentStore
} from './attachment-store'

declare const Bun: {
	serve(input: {
		port?: number
		hostname?: string
		idleTimeout?: number
		fetch(request: Request): Response | Promise<Response>
	}): {
		port: number
		url: URL
		stop(closeActiveConnections?: boolean): void
	}
}

type IntentRecord = {
	id: string
	state: unknown
	version: number
	createdAt: string
	updatedAt: string
}

type SqliteQueryable = ReturnType<typeof asSqlitePersistence> & {
	db: {
		query(sql: string): {
			get(...params: Array<string | number | null>): unknown
			all(...params: Array<string | number | null>): unknown[]
		}
	}
	listIntents(): Promise<IntentRecord[]>
	getIntent(intentId: string): Promise<IntentRecord | null>
	listEvents(input: { after?: number; limit?: number; visibility?: EventVisibility | EventVisibility[]; runId?: string; intentId?: string; actorId?: string; callId?: string }): Promise<EventRecord[]>
	listSkills(): Promise<SkillRecord[]>
	getActor(id: string): Promise<ActorRecord | null>
	listActorHierarchy(input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]>
	listStructuralActorChildren(input: { parentActorId?: string | null }): Promise<Array<ActorHierarchyRecord & { directChildCount: number }>>
	listCommunicationActorChildren(input: { actorId?: string | null }): Promise<Array<ActorHierarchyRecord & { directChildCount: number; messageCount: number }>>
	listActorBranchLogs(input: {
		rootActorId: string
		view?: 'chat' | 'deep-dive'
		after?: number
		limit?: number
	}): Promise<ActorLogRecord[]>
	listCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]>
	listContextItems(input: { selector: ContextQuery; snapshotSeq?: number }): Promise<ContextItemRecord[]>
	summarizeCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeSummary>
}

type ActorHierarchyNodeRecord = ActorHierarchyRecord & {
	directChildCount: number
}

type CommunicationTreeNodeRecord = CommunicationTreeRecord & {
	directChildCount: number
}

type IntentActorKind = 'intent' | 'skill' | 'worker' | 'system' | 'human' | 'group' | 'unknown'

type IntentActorNode = {
	actorId: string
	uiParentActorId: string | null
	pathParentActorId: string | null
	kind: IntentActorKind
	label: string
	subtitle?: string
	isAggregateRoot: boolean
	isVirtual: boolean
	status?: 'active' | 'idle' | 'completed' | 'failed'
	eventCount: number
	envelopeCount: number
	contextCount: number
	firstSeenAt: string | null
	lastSeenAt: string | null
}

type EnvelopeDto = {
	id: string
	fromActor: string
	toActor: string
	type: string
	runId: string
	causedBy: string | null
	status: string
	payload: unknown
	createdAt: string
	updatedAt: string
}

type ActorDetailDto = {
	actorId: string
	kind: string
	status: string | null
	state: unknown
	version: number | null
	createdAt: string | null
	updatedAt: string | null
	config?: unknown
}

type EventAggregateRow = {
	actor_id: string
	event_count: number
	first_seen_at: string | null
	last_seen_at: string | null
}

type ContextAggregateRow = {
	actor_id: string
	context_count: number
	first_seen_at: string | null
	last_seen_at: string | null
}

type EnvelopeAggregateRow = {
	actor_id: string
	envelope_count: number
	first_seen_at: string | null
	last_seen_at: string | null
}

type EnvelopeRow = {
	id: string
	from_actor: string
	to_actor: string
	type: string
	run_id: string
	caused_by: string | null
	status: string
	payload_json: string
	created_at: string
	updated_at: string
}

type ActorRow = {
	id: string
	kind: string
	status: string
	state_json: string
	version: number
	created_at: string
	updated_at: string
}

export interface CreateWebApiInput extends CreateAppNodeInput {
	port?: number
	hostname?: string
	runtimeConcurrency?: number
	pollIntervalMs?: number
	idleDelayMs?: number
	idleTimeoutSeconds?: number
	streamHeartbeatMs?: number
}

export interface WebApi {
	app: AppNode
	attachmentStore: AttachmentStore
	port: number
	hostname: string
	url: string
	stop(): Promise<void>
	startDaemon(): void
	stopDaemon(): Promise<void>
	server: {
		port: number
		url: URL
		stop(closeActiveConnections?: boolean): void
	}
}

export async function createWebApi(input: CreateWebApiInput): Promise<WebApi> {
	const workspaceRoot = input.workspaceRoot ?? process.cwd()
	const uploadRoot =
		input.sharedSkillResources?.uploadRoot ??
		process.env.JAENSEN_UPLOAD_DIR ??
		DEFAULT_ATTACHMENT_ROOT
	const app = await createAppNode({
		...input,
		workspaceRoot,
		sharedSkillResources: {
			...input.sharedSkillResources,
			uploadRoot
		}
	})
	const attachmentStore = createAttachmentStore({
		workspaceRoot,
		attachmentRoot: uploadRoot
	})
	const persistence = asQueryablePersistence(app)
	const pollIntervalMs = input.pollIntervalMs ?? 150
	const idleDelayMs = input.idleDelayMs ?? 100
	const streamHeartbeatMs = input.streamHeartbeatMs ?? 5_000
	const runtimeConcurrency = normalizeRuntimeConcurrency(input.runtimeConcurrency)

	let daemonRunning = true
	let daemonPromise: Promise<void> | null = null
	const baseWorkerId = input.workerId ?? `node-${process.pid}`

	async function runDaemonSlot(slot: number): Promise<void> {
		const workerId = `${baseWorkerId}-${slot}`

		while (daemonRunning) {
			let result: 'processed' | 'idle'
			try {
				result = await app.tick({ workerId })
			} catch (error) {
				console.error('[jaensen/web-api] daemon tick failed', { slot, workerId, error })
				await sleep(idleDelayMs)
				continue
			}
			if (result === 'idle') {
				await sleep(idleDelayMs)
			}
		}
	}

	function startDaemon(): void {
		if (daemonPromise) {
			return
		}
		daemonRunning = true

		daemonPromise = (async () => {
			await Promise.all(Array.from({ length: runtimeConcurrency }, (_, slot) => runDaemonSlot(slot)))
		})()
	}

	async function stopDaemon(): Promise<void> {
		daemonRunning = false
		if (daemonPromise) {
			await daemonPromise
			daemonPromise = null
		}
	}

	const server = Bun.serve({
		port: input.port ?? 0,
		hostname: input.hostname ?? '127.0.0.1',
		idleTimeout: input.idleTimeoutSeconds ?? 30,
		fetch(request) {
			return routeRequest({ request, app, attachmentStore, persistence, pollIntervalMs, streamHeartbeatMs })
		}
	})

	startDaemon()

	return {
		app,
		attachmentStore,
		port: server.port,
		hostname: server.url.hostname,
		url: server.url.toString(),
		server,
		startDaemon,
		stopDaemon,
		async stop() {
			server.stop(true)
			await stopDaemon()
		}
	}
}

async function routeRequest(input: {
	request: Request
	app: AppNode
	attachmentStore: AttachmentStore
	persistence: SqliteQueryable
	pollIntervalMs: number
	streamHeartbeatMs: number
}): Promise<Response> {
	const url = new URL(input.request.url)
	const path = trimTrailingSlash(url.pathname)

	if (input.request.method === 'POST' && path === '/api/messages') {
		return handlePostMessages(input.request, input.app, input.attachmentStore)
	}

	if (input.request.method === 'POST' && path === '/api/attachments') {
		return handlePostAttachments(input.request, input.attachmentStore)
	}

	if (input.request.method === 'GET' && path === '/api/intents') {
		return jsonResponse({ intents: (await input.persistence.listIntents()).map(mapIntentRecord) })
	}

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		const intent = await input.persistence.getIntent(intentId)
		return intent ? jsonResponse(mapIntentRecord(intent)) : notFound(`Intent ${intentId} not found`)
	}

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/actors$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		return jsonResponse({ actors: await listIntentActors(input.persistence, intentId) })
	}

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/activity$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		const actorId = url.searchParams.get('actorId')?.trim() || undefined
		const after = parseAfter(url.searchParams.get('after'))
		const limit = parseLimit(url.searchParams.get('limit'))
		const visibility = parseVisibility(url.searchParams.get('visibility'))
		const intentActorId = createIntentActorId(intentId)
		const events = await input.persistence.listEvents({
			after,
			limit,
			visibility,
			intentId,
			actorId: actorId && actorId !== intentActorId ? actorId : undefined
		})
		return jsonResponse({ events })
	}

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/envelopes$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		const actorId = url.searchParams.get('actorId')?.trim() || undefined
		const after = url.searchParams.get('after')?.trim() || undefined
		const limit = parseLimit(url.searchParams.get('limit'))
		return jsonResponse({
			envelopes: await listIntentEnvelopes(input.persistence, {
				intentId,
				actorId,
				after,
				limit
			})
		})
	}

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/events$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		const after = parseAfter(url.searchParams.get('after'))
		const events = await input.persistence.listEvents({ intentId, after, limit: 200 })
		return jsonResponse({ events })
	}

	if (input.request.method === 'GET' && path === '/api/events') {
		const after = parseAfter(url.searchParams.get('after'))
		const limit = parseLimit(url.searchParams.get('limit'))
		const visibility = parseVisibility(url.searchParams.get('visibility'))
		const runId = url.searchParams.get('runId')?.trim() || undefined
		const intentId = url.searchParams.get('intentId')?.trim() || undefined
		const actorId = url.searchParams.get('actorId')?.trim() || undefined
		const callId = url.searchParams.get('callId')?.trim() || undefined
		const events = await input.persistence.listEvents({ after, limit, visibility, runId, intentId, actorId, callId })
		return jsonResponse({ events })
	}

	if (input.request.method === 'GET' && path === '/api/context/items') {
		const selector = selectorFromQuery(url.searchParams)
		const items = await input.persistence.listContextItems({ selector })
		return jsonResponse({ items })
	}

	if (input.request.method === 'GET' && path === '/api/actors/hierarchy') {
		const rootActorId = url.searchParams.get('rootActorId')?.trim()
		if (!rootActorId) return badRequest('Missing rootActorId')
		const observed = url.searchParams.get('observed') === 'true'
		const parentActorId = url.searchParams.get('parentActorId')?.trim() || undefined
		const actors = await input.persistence.listActorHierarchy({ rootActorId, observed, includeRoot: true })
		const childCounts = new Map<string, number>()
		for (const actor of actors) {
			if (!actor.parentActorId) continue
			childCounts.set(actor.parentActorId, (childCounts.get(actor.parentActorId) ?? 0) + 1)
		}
		const filteredActors = parentActorId
			? actors.filter((actor) => actor.parentActorId === parentActorId)
			: actors.filter((actor) => actor.actorId === rootActorId)
		const responseActors: ActorHierarchyNodeRecord[] = filteredActors.map((actor) => ({
			...actor,
			directChildCount: childCounts.get(actor.actorId) ?? 0
		}))
		return jsonResponse({ actors: responseActors })
	}

	if (input.request.method === 'GET' && path === '/api/actors/structural-children') {
		const parentActorId = url.searchParams.get('parentActorId')?.trim() || null
		const actors = await input.persistence.listStructuralActorChildren({ parentActorId })
		return jsonResponse({ actors })
	}

	if (input.request.method === 'GET' && path === '/api/actors/communication-children') {
		const actorId = url.searchParams.get('actorId')?.trim() || null
		const actors = await input.persistence.listCommunicationActorChildren({ actorId })
		return jsonResponse({ actors })
	}

	if (input.request.method === 'GET' && path === '/api/actors/branch-logs') {
		const rootActorId = url.searchParams.get('rootActorId')?.trim()
		if (!rootActorId) return badRequest('Missing rootActorId')
		const view = url.searchParams.get('view') === 'chat' ? 'chat' : 'deep-dive'
		const after = parseAfter(url.searchParams.get('after'))
		const limit = parseLimit(url.searchParams.get('limit'))
		const events = await input.persistence.listActorBranchLogs({ rootActorId, view, after, limit })
		return jsonResponse({ events })
	}

	if (input.request.method === 'GET' && /^\/api\/actors\/.+$/.test(path)) {
		const actorId = decodeURIComponent(path.slice('/api/actors/'.length))
		return jsonResponse(await getActorDetail(input.persistence, actorId))
	}

	if (input.request.method === 'GET' && path === '/api/communication/tree') {
		const view = url.searchParams.get('view') === 'chat' ? 'chat' : 'deep-dive'
		const runId = url.searchParams.get('runId')?.trim() || undefined
		const intentId = url.searchParams.get('intentId')?.trim() || undefined
		const rootEnvelopeId = url.searchParams.get('rootEnvelopeId')?.trim() || undefined
		const nodeId = url.searchParams.get('nodeId')?.trim() || undefined
		if (!runId && !intentId && !rootEnvelopeId) return badRequest('Missing runId, intentId, or rootEnvelopeId')
		const tree = await input.persistence.listCommunicationTree({ runId, intentId, rootEnvelopeId, view })
		const summary = await input.persistence.summarizeCommunicationTree({ runId, intentId, rootEnvelopeId, view })
		const childCounts = new Map<string, number>()
		for (const node of tree) {
			if (!node.parentNodeId) continue
			childCounts.set(node.parentNodeId, (childCounts.get(node.parentNodeId) ?? 0) + 1)
		}
		const filteredTree = nodeId ? tree.filter((node) => node.parentNodeId === nodeId) : tree.filter((node) => node.parentNodeId === null)
		const responseTree: CommunicationTreeNodeRecord[] = filteredTree.map((node) => ({
			...node,
			directChildCount: childCounts.get(node.nodeId) ?? 0
		}))
		return jsonResponse({ tree: responseTree, summary })
	}

	if (input.request.method === 'GET' && path === '/api/events/stream') {
		const after = maxAfter(
			parseAfter(url.searchParams.get('after')),
			parseAfter(input.request.headers.get('last-event-id'))
		)

		return createEventStreamResponse({
			persistence: input.persistence,
			runId: url.searchParams.get('runId')?.trim() || undefined,
			intentId: url.searchParams.get('intentId')?.trim() || undefined,
			actorId: url.searchParams.get('actorId')?.trim() || undefined,
			callId: url.searchParams.get('callId')?.trim() || undefined,
			visibility: parseVisibility(url.searchParams.get('visibility')),
			after,
			pollIntervalMs: input.pollIntervalMs,
			heartbeatMs: input.streamHeartbeatMs,
			signal: input.request.signal
		})
	}

	return notFound(`No route for ${input.request.method} ${path}`)
}

function parseLimit(raw: string | null): number | undefined {
	if (!raw) return undefined
	const value = Number(raw)
	if (!Number.isFinite(value) || value <= 0) return undefined
	return Math.min(1000, Math.trunc(value))
}

async function handlePostMessages(request: Request, app: AppNode, attachmentStore: AttachmentStore): Promise<Response> {
	const payload = await request.json().catch(() => null)
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return badRequest('Body must be a JSON object')
	}

	const text = typeof payload.text === 'string' ? payload.text.trim() : ''
	if (!text) {
		return badRequest('text is required')
	}

	let sessionId: string
	let attachments: UserAttachment[]
	let attachmentScopeId: string
	try {
		sessionId = getOrIssueSessionId(request, attachmentStore)
		const materialized = await attachmentStore.materializeForMessage({
			sessionId,
			attachments: (payload as Record<string, unknown>).attachments,
			messageScopeId: crypto.randomUUID()
		})
		attachments = materialized.attachments
		attachmentScopeId = materialized.attachmentScopeId
	} catch (error) {
		if (error instanceof AttachmentValidationError) {
			return badRequest(error.message)
		}
		throw error
	}

	const payloadRecord = payload as Record<string, unknown>
	const rawIntentIdHint = payloadRecord.intentIdHint
	const intentIdHint = typeof rawIntentIdHint === 'string' ? rawIntentIdHint.trim() || undefined : undefined
	const result = await app.enqueueUserInput({
		text,
		attachments,
		attachmentScopeId,
		intentIdHint,
	})
	return jsonResponse(result, {
		status: 202,
		headers: { 'x-jaensen-session-id': sessionId, 'x-jaensen-attachment-scope-id': attachmentScopeId }
	})
}

async function handlePostAttachments(request: Request, attachmentStore: AttachmentStore): Promise<Response> {
	const payload = await request.json().catch(() => null)
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return badRequest('Body must be a JSON object')
	}

	try {
		const sessionId = getOrIssueSessionId(request, attachmentStore)
		const attachments = await attachmentStore.stageUploads({
			sessionId,
			attachments: (payload as Record<string, unknown>).attachments
		})
		return jsonResponse(
			{ attachments },
			{ status: 201, headers: { 'x-jaensen-session-id': sessionId } }
		)
	} catch (error) {
		if (error instanceof AttachmentValidationError) {
			return badRequest(error.message)
		}
		throw error
	}
}

function createEventStreamResponse(input: {
	persistence: SqliteQueryable
	runId?: string
	intentId?: string
	actorId?: string
	callId?: string
	visibility?: EventVisibility
	after: number
	pollIntervalMs: number
	heartbeatMs: number
	signal: AbortSignal
}): Response {
	const encoder = new TextEncoder()
	let closed = false

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let cursor = input.after
			let lastWriteAt = Date.now()
			controller.enqueue(encoder.encode(`retry: ${input.pollIntervalMs}\n\n`))
			lastWriteAt = Date.now()

			const abort = () => {
				closed = true
				try {
					controller.close()
				} catch {
					// ignore close races
				}
			}

			input.signal.addEventListener('abort', abort, { once: true })

			try {
				while (!closed && !input.signal.aborted) {
					const events = await input.persistence.listEvents({ after: cursor, limit: 200, runId: input.runId, intentId: input.intentId, actorId: input.actorId, callId: input.callId, visibility: input.visibility })

					if (events.length === 0) {
						if (Date.now() - lastWriteAt >= input.heartbeatMs) {
							controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
							lastWriteAt = Date.now()
						}
						await sleep(input.pollIntervalMs)
						continue
					}

					for (const event of events) {
						cursor = event.seq
						controller.enqueue(encoder.encode(formatSseEvent(event)))
						lastWriteAt = Date.now()
					}
				}
			} finally {
				input.signal.removeEventListener('abort', abort)
				if (!closed) {
					abort()
				}
			}
		}
	})

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	})
}

function formatSseEvent(event: EventRecord): string {
	return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

async function listIntentActors(persistence: SqliteQueryable, intentId: string): Promise<IntentActorNode[]> {
	const rootActorId = createIntentActorId(intentId)
	const lifecycleEnvelopes = await listIntentEnvelopes(persistence, { intentId, limit: 1000 })
	const eventRows = persistence.db
		.query(
			`SELECT actor_id, COUNT(*) AS event_count, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
			 FROM events
			 WHERE intent_id = ? AND actor_id IS NOT NULL
			 GROUP BY actor_id`
		)
		.all(intentId) as EventAggregateRow[]
	const contextRows = persistence.db
		.query(
			`SELECT actor_id, COUNT(*) AS context_count, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
			 FROM context_items
			 WHERE intent_id = ? AND actor_id IS NOT NULL
			 GROUP BY actor_id`
		)
		.all(intentId) as ContextAggregateRow[]
	const envelopeRows = aggregateEnvelopeActors(lifecycleEnvelopes)
	const actorIds = new Set<string>([rootActorId])

	for (const row of eventRows) actorIds.add(row.actor_id)
	for (const row of contextRows) actorIds.add(row.actor_id)
	for (const envelope of lifecycleEnvelopes) {
		actorIds.add(envelope.fromActor)
		actorIds.add(envelope.toActor)
	}
	for (const actorId of [...actorIds]) {
		const worker = parseSkillWorkerActorId(actorId)
		if (worker) actorIds.add(`aven/skills/${worker.skillId}`)
	}

	const realActorIds = [...actorIds].filter((actorId) => !actorId.startsWith('aven/groups/'))
	const actorRows = persistence.db
		.query(
			`SELECT id, kind, status, state_json, version, created_at, updated_at
			 FROM actors
			 WHERE id IN (${realActorIds.map(() => '?').join(', ')})`
		)
		.all(...realActorIds) as ActorRow[]

	const actorMeta = new Map(actorRows.map((row) => [row.id, row]))
	const eventMeta = new Map(eventRows.map((row) => [row.actor_id, row]))
	const contextMeta = new Map(contextRows.map((row) => [row.actor_id, row]))
	const envelopeMeta = new Map(envelopeRows.map((row) => [row.actor_id, row]))

	const nodes = [...actorIds]
		.map((actorId) => buildIntentActorNode({
			actorId,
			intentId,
			rootActorId,
			actorRow: actorMeta.get(actorId),
			eventRow: eventMeta.get(actorId),
			contextRow: contextMeta.get(actorId),
			envelopeRow: envelopeMeta.get(actorId),
			isVirtualInserted: !actorMeta.has(actorId) && !eventMeta.has(actorId) && !contextMeta.has(actorId) && !envelopeMeta.has(actorId)
		}))
		.sort(compareIntentActorNodes)

	const rootIndex = nodes.findIndex((node) => node.actorId === rootActorId)
	if (rootIndex > 0) {
		const [root] = nodes.splice(rootIndex, 1)
		nodes.unshift(root)
	}

	return nodes
}

async function listIntentEnvelopes(
	persistence: SqliteQueryable,
	input: { intentId: string; actorId?: string; after?: string; limit?: number }
): Promise<EnvelopeDto[]> {
	const rootActorId = createIntentActorId(input.intentId)
	const limit = input.limit ?? 200
	const runIdRows = persistence.db
		.query(
			`SELECT DISTINCT run_id AS run_id FROM events WHERE intent_id = ? AND run_id IS NOT NULL
			 UNION
			 SELECT DISTINCT run_id AS run_id FROM context_items WHERE intent_id = ? AND run_id IS NOT NULL`
		)
		.all(input.intentId, input.intentId) as Array<{ run_id: string }>
	const runIds = runIdRows.map((row) => row.run_id)
	const clauses: string[] = []
	const params: Array<string | number | null> = []

	if (runIds.length > 0) {
		clauses.push(`run_id IN (${runIds.map(() => '?').join(', ')})`)
		params.push(...runIds)
	}
	clauses.push('from_actor = ?')
	params.push(rootActorId)
	clauses.push('to_actor = ?')
	params.push(rootActorId)

	let sql = `SELECT id, from_actor, to_actor, type, run_id, caused_by, status, payload_json, created_at, updated_at
		FROM envelopes
		WHERE (${clauses.join(' OR ')})`

	const selectedActorId = input.actorId && input.actorId !== rootActorId ? input.actorId : undefined
	if (selectedActorId) {
		sql += ' AND (from_actor = ? OR to_actor = ?)'
		params.push(selectedActorId, selectedActorId)
	}
	if (input.after) {
		sql += ' AND created_at > COALESCE((SELECT created_at FROM envelopes WHERE id = ?), "")'
		params.push(input.after)
	}
	sql += ' ORDER BY created_at ASC, id ASC LIMIT ?'
	params.push(limit)

	const rows = persistence.db.query(sql).all(...params) as EnvelopeRow[]
	return rows.map((row) => ({
		id: row.id,
		fromActor: row.from_actor,
		toActor: row.to_actor,
		type: row.type,
		runId: row.run_id,
		causedBy: row.caused_by,
		status: row.status,
		payload: JSON.parse(row.payload_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}))
}

async function getActorDetail(persistence: SqliteQueryable, actorId: string): Promise<ActorDetailDto> {
	const actor = await persistence.getActor(actorId)
	const parsed = parseActorId(actorId)
	const detail: ActorDetailDto = {
		actorId,
		kind: actor?.kind ?? parsed.kind,
		status: actor?.status ?? null,
		state: actor?.state ?? null,
		version: actor?.version ?? null,
		createdAt: actor?.createdAt ?? null,
		updatedAt: actor?.updatedAt ?? null
	}

	const skill = parseSkillActorId(actorId)
	if (skill) {
		const skillRecord = (await persistence.listSkills()).find((item) => item.id === skill.skillId)
		if (skillRecord) {
			detail.config = {
				skillId: skillRecord.id,
				path: skillRecord.path,
				frontmatter: skillRecord.frontmatter,
				loadedAt: skillRecord.loadedAt,
				body: skillRecord.body
			}
		}
	}

	return detail
}

function aggregateEnvelopeActors(envelopes: EnvelopeDto[]): EnvelopeAggregateRow[] {
	const counts = new Map<string, EnvelopeAggregateRow>()
	for (const envelope of envelopes) {
		for (const actorId of [envelope.fromActor, envelope.toActor]) {
			const current = counts.get(actorId) ?? {
				actor_id: actorId,
				envelope_count: 0,
				first_seen_at: null,
				last_seen_at: null
			}
			current.envelope_count += 1
			current.first_seen_at = minIso(current.first_seen_at, envelope.createdAt)
			current.last_seen_at = maxIso(current.last_seen_at, envelope.updatedAt)
			counts.set(actorId, current)
		}
	}
	return [...counts.values()]
}

function buildIntentActorNode(input: {
	actorId: string
	intentId: string
	rootActorId: string
	actorRow?: ActorRow
	eventRow?: EventAggregateRow
	contextRow?: ContextAggregateRow
	envelopeRow?: EnvelopeAggregateRow
	isVirtualInserted: boolean
}): IntentActorNode {
	if (input.actorId === input.rootActorId) {
		return {
			actorId: input.rootActorId,
			uiParentActorId: null,
			pathParentActorId: 'aven/intents',
			kind: 'intent',
			label: 'Intent lifecycle',
			isAggregateRoot: true,
			isVirtual: false,
			status: mapActorStatus(input.actorRow?.status),
			eventCount: input.eventRow?.event_count ?? 0,
			envelopeCount: input.envelopeRow?.envelope_count ?? 0,
			contextCount: input.contextRow?.context_count ?? 0,
			firstSeenAt: pickFirstSeen(input.eventRow?.first_seen_at, input.contextRow?.first_seen_at, input.envelopeRow?.first_seen_at),
			lastSeenAt: pickLastSeen(input.eventRow?.last_seen_at, input.contextRow?.last_seen_at, input.envelopeRow?.last_seen_at)
		}
	}

	const parsed = parseActorId(input.actorId)
	const kind = mapIntentActorKind(input.actorId)
	const parentSkillActorId = parseSkillWorkerActorId(input.actorId)?.skillId
	return {
		actorId: input.actorId,
		uiParentActorId:
			kind === 'worker'
				? `aven/skills/${parentSkillActorId}`
				: kind === 'intent'
					? null
					: input.rootActorId,
		pathParentActorId: parsed.parentId,
		kind,
		label: labelForActor(input.actorId),
		subtitle: input.actorId,
		isAggregateRoot: false,
		isVirtual: input.isVirtualInserted,
		status: mapActorStatus(input.actorRow?.status),
		eventCount: input.eventRow?.event_count ?? 0,
		envelopeCount: input.envelopeRow?.envelope_count ?? 0,
		contextCount: input.contextRow?.context_count ?? 0,
		firstSeenAt: pickFirstSeen(input.eventRow?.first_seen_at, input.contextRow?.first_seen_at, input.envelopeRow?.first_seen_at),
		lastSeenAt: pickLastSeen(input.eventRow?.last_seen_at, input.contextRow?.last_seen_at, input.envelopeRow?.last_seen_at)
	}
}

function compareIntentActorNodes(a: IntentActorNode, b: IntentActorNode): number {
	if (a.isAggregateRoot && !b.isAggregateRoot) return -1
	if (!a.isAggregateRoot && b.isAggregateRoot) return 1
	if (a.uiParentActorId === null && b.uiParentActorId !== null) return -1
	if (a.uiParentActorId !== null && b.uiParentActorId === null) return 1
	return a.actorId.localeCompare(b.actorId)
}

function mapIntentActorKind(actorId: string): IntentActorKind {
	const parsed = parseActorId(actorId)
	if (actorId === HUMAN_ACTOR_ID) return 'human'
	if (parsed.kind === 'system') return 'system'
	if (parsed.kind === 'intent') return 'intent'
	if (parsed.kind === 'skill') return 'skill'
	if (parsed.kind === 'worker') return 'worker'
	if (parsed.kind === 'group') return 'group'
	return 'unknown'
}

function labelForActor(actorId: string): string {
	if (actorId === HUMAN_ACTOR_ID) return 'Human'
	const skill = parseSkillActorId(actorId)
	if (skill) return skill.skillId
	const worker = parseSkillWorkerActorId(actorId)
	if (worker) return worker.workerName
	const parsed = parseActorId(actorId)
	return parsed.name
		.split('-')
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(' ')
}

function mapActorStatus(status: string | undefined): 'active' | 'idle' | 'completed' | 'failed' | undefined {
	if (status === 'active') return 'active'
	if (status === 'stopped') return 'completed'
	if (status === 'failed') return 'failed'
	return undefined
}

function pickFirstSeen(...values: Array<string | null | undefined>): string | null {
	return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null
}

function pickLastSeen(...values: Array<string | null | undefined>): string | null {
	return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
}

function minIso(current: string | null, next: string): string {
	return !current || next < current ? next : current
}

function maxIso(current: string | null, next: string): string {
	return !current || next > current ? next : current
}

function parseVisibility(raw: string | null): EventVisibility | undefined {
	if (raw === 'chat' || raw === 'worklog' || raw === 'debug') return raw
	return undefined
}

function mapIntentRecord(intent: IntentRecord) {
	const state = toRecord(intent.state)
	return {
		id: intent.id,
		title: readOptionalString(state.title),
		goal: readOptionalString(state.goal),
		status: readOptionalString(state.status),
		summary: readOptionalString(state.summary),
		pendingSkillCalls:
			state.pendingSkillCalls && typeof state.pendingSkillCalls === 'object' && !Array.isArray(state.pendingSkillCalls)
				? state.pendingSkillCalls
				: {},
		version: intent.version,
		createdAt: intent.createdAt,
		updatedAt: intent.updatedAt,
		state: intent.state
	}
}

function asQueryablePersistence(app: AppNode): SqliteQueryable {
	const persistence = asSqlitePersistence(app.persistence)
	if (!persistence) {
		throw new TypeError('@jaensen/web-api requires SqlitePersistence-backed app-node persistence')
	}
	return persistence as SqliteQueryable
}

function getOrIssueSessionId(request: Request, attachmentStore: AttachmentStore): string {
	const existing = request.headers.get('x-jaensen-session-id')?.trim()
	if (!existing) {
		return attachmentStore.issueSessionId()
	}
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
		throw new AttachmentValidationError('Invalid session id.')
	}
	return existing
}

function parseAfter(value: string | null): number {
	if (!value) {
		return 0
	}

	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function selectorFromQuery(searchParams: URLSearchParams): ContextQuery {
	const selector: ContextQuery = {
		afterSeq: parseOptionalInt(searchParams.get('afterSeq')),
		limit: parseOptionalInt(searchParams.get('limit'))
	}
	const kind = searchParams.get('kind')?.trim()
	if (kind) selector.kind = kind
	const actorId = searchParams.get('actorId')?.trim()
	if (actorId) selector.actorId = actorId
	const runId = searchParams.get('runId')?.trim()
	if (runId) selector.runId = runId
	const intentId = searchParams.get('intentId')?.trim()
	if (intentId) selector.intentId = intentId
	const callId = searchParams.get('callId')?.trim()
	if (callId) selector.callId = callId
	const visibility = searchParams.get('visibility')?.trim()
	if (visibility === 'chat' || visibility === 'worklog' || visibility === 'debug') selector.visibility = visibility
	return selector
}

function parseOptionalInt(raw: string | null): number | undefined {
	if (!raw) return undefined
	const parsed = Number.parseInt(raw, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

function maxAfter(a: number, b: number): number {
	return Math.max(a, b)
}

function normalizeRuntimeConcurrency(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 4
	}

	return Math.max(1, Math.min(32, Math.trunc(value)))
}

function trimTrailingSlash(pathname: string): string {
	return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readOptionalString(value: unknown): string | null {
	return typeof value === 'string' ? value : null
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			...(init?.headers ?? {})
		}
	})
}

function badRequest(message: string): Response {
	return jsonResponse({ error: message }, { status: 400 })
}

function notFound(message: string): Response {
	return jsonResponse({ error: message }, { status: 404 })
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds))
}