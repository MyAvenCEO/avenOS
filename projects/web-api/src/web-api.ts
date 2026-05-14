import {
	asSqlitePersistence,
	createAppNode,
	type AppNode,
	type CreateAppNodeInput
} from '@jaensen/app-node'
import type { UserAttachment } from '@jaensen/conversation-actors'
import type {
	ActorHierarchyRecord,
	ActorLogRecord,
	CommunicationTreeRecord,
	CommunicationTreeSummary,
	ContextItemRecord,
	ContextScope,
	ContextSelector,
	StreamEventRecord
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
	listIntents(): Promise<IntentRecord[]>
	getIntent(intentId: string): Promise<IntentRecord | null>
	listStreamEvents(input: { scope: string; after?: number; limit?: number }): Promise<StreamEventRecord[]>
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
		correlationId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]>
	listContextItems(input: { selector: ContextSelector; snapshotSeq?: number }): Promise<ContextItemRecord[]>
	summarizeCommunicationTree(input: {
		correlationId?: string
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

type RuntimeActorEvent = { type: string } & Record<string, unknown>

export interface CreateWebApiInput extends CreateAppNodeInput {
	port?: number
	hostname?: string
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

	let daemonRunning = true
	let daemonPromise: Promise<void> | null = null

	function startDaemon(): void {
		if (daemonPromise) {
			return
		}
		daemonRunning = true

		daemonPromise = (async () => {
			while (daemonRunning) {
				let result: 'processed' | 'idle'
				try {
					result = await app.tick()
				} catch (error) {
					console.error('[jaensen/web-api] daemon tick failed', error)
					await sleep(idleDelayMs)
					continue
				}
				if (result === 'idle') {
					await sleep(idleDelayMs)
				}
			}
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

	if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/events$/.test(path)) {
		const intentId = decodeURIComponent(path.split('/')[3] ?? '')
		const after = parseAfter(url.searchParams.get('after'))
		const events = await input.persistence.listStreamEvents({ scope: `intents/${intentId}`, after })
		return jsonResponse({ events })
	}

	if (input.request.method === 'GET' && path === '/api/events') {
		const scope = url.searchParams.get('scope')
		if (!scope) {
			return badRequest('Missing scope')
		}
		const after = parseAfter(url.searchParams.get('after'))
		const events = await input.persistence.listStreamEvents({ scope, after })
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

	if (input.request.method === 'GET' && path === '/api/communication/tree') {
		const view = url.searchParams.get('view') === 'chat' ? 'chat' : 'deep-dive'
		const correlationId = url.searchParams.get('correlationId')?.trim() || undefined
		const intentId = url.searchParams.get('intentId')?.trim() || undefined
		const rootEnvelopeId = url.searchParams.get('rootEnvelopeId')?.trim() || undefined
		const nodeId = url.searchParams.get('nodeId')?.trim() || undefined
		if (!correlationId && !intentId && !rootEnvelopeId) return badRequest('Missing correlationId, intentId, or rootEnvelopeId')
		const tree = await input.persistence.listCommunicationTree({ correlationId, intentId, rootEnvelopeId, view })
		const summary = await input.persistence.summarizeCommunicationTree({ correlationId, intentId, rootEnvelopeId, view })
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
		const scope = url.searchParams.get('scope')
		if (!scope) {
			return badRequest('Missing scope')
		}

		const after = maxAfter(
			parseAfter(url.searchParams.get('after')),
			parseAfter(input.request.headers.get('last-event-id'))
		)

		return createEventStreamResponse({
			persistence: input.persistence,
			scope,
			after,
			pollIntervalMs: input.pollIntervalMs,
			heartbeatMs: input.streamHeartbeatMs,
			signal: input.request.signal
		})
	}

	if (input.request.method === 'GET' && path === '/debug/actors') {
		return jsonResponse(input.app.runtime.debug.getSnapshot())
	}

	if (input.request.method === 'GET' && path === '/debug/actors/events') {
		const after = maxAfter(
			parseAfter(url.searchParams.get('after')),
			parseAfter(input.request.headers.get('last-event-id'))
		)
		return createActorDebugStreamResponse({
			app: input.app,
			after,
			signal: input.request.signal,
			heartbeatMs: input.streamHeartbeatMs
		})
	}

	return notFound(`No route for ${input.request.method} ${path}`)
}

function createActorDebugStreamResponse(input: {
	app: AppNode
	after: number
	signal: AbortSignal
	heartbeatMs: number
}): Response {
	const encoder = new TextEncoder()
	const pending = input.app.runtime.debug.listEvents(input.after)
	let closed = false

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(`retry: 1000\n\n`))
			let lastWriteAt = Date.now()

			for (const item of pending) {
				controller.enqueue(encoder.encode(formatActorDebugSseEvent(item.seq, item.event)))
				lastWriteAt = Date.now()
			}

			const unsubscribe = input.app.runtime.debug.subscribe((item) => {
				if (closed || item.seq <= input.after) return
				controller.enqueue(encoder.encode(formatActorDebugSseEvent(item.seq, item.event)))
				lastWriteAt = Date.now()
			})

			const heartbeat = setInterval(() => {
				if (closed) return
				if (Date.now() - lastWriteAt >= input.heartbeatMs) {
					controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
					lastWriteAt = Date.now()
				}
			}, Math.max(250, Math.min(input.heartbeatMs, 1000)))

			const abort = () => {
				if (closed) return
				closed = true
				clearInterval(heartbeat)
				unsubscribe()
				try {
					controller.close()
				} catch {
					// ignore close races
				}
			}

			input.signal.addEventListener('abort', abort, { once: true })
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

function formatActorDebugSseEvent(seq: number, event: RuntimeActorEvent): string {
	return `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
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
	scope: string
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
					const events = await input.persistence.listStreamEvents({
						scope: input.scope,
						after: cursor,
						limit: 200
					})

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

function formatSseEvent(event: StreamEventRecord): string {
	return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
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

function selectorFromQuery(searchParams: URLSearchParams): ContextSelector {
	const scopes: ContextScope[] = []
	const scopeType = searchParams.get('scopeType')?.trim()
	const scopeKey = searchParams.get('scopeKey')?.trim()
	if (scopeType && scopeKey) {
		scopes.push(scopeFromQuery(scopeType, scopeKey))
	}

	const selector: ContextSelector = {
		afterSeq: parseOptionalInt(searchParams.get('afterSeq')),
		limit: parseOptionalInt(searchParams.get('limit'))
	}
	if (scopes.length > 0) selector.scopes = scopes
	const kind = searchParams.get('kind')?.trim()
	if (kind) selector.kinds = [kind as ContextItemRecord['kind']]
	const key = searchParams.get('key')?.trim()
	if (key) selector.keys = [key]
	const actorId = searchParams.get('actorId')?.trim()
	if (actorId) selector.producedByActorIds = [actorId]
	if (searchParams.get('correlationId')?.trim()) {
		selector.scopes = [...(selector.scopes ?? []), { type: 'run', correlationId: searchParams.get('correlationId')!.trim() }]
	}
	if (searchParams.get('intentId')?.trim()) {
		selector.scopes = [...(selector.scopes ?? []), { type: 'intent', intentId: searchParams.get('intentId')!.trim() }]
	}
	const callId = searchParams.get('callId')?.trim()
	const rootCallId = searchParams.get('rootCallId')?.trim()
	if (callId) {
		selector.scopes = [...(selector.scopes ?? []), { type: 'call', callId, rootCallId: rootCallId ?? callId }]
	}
	return selector
}

function scopeFromQuery(scopeType: string, scopeKey: string): ContextScope {
	if (scopeType === 'run') return { type: 'run', correlationId: scopeKey }
	if (scopeType === 'intent') return { type: 'intent', intentId: scopeKey }
	if (scopeType === 'call') return { type: 'call', callId: scopeKey, rootCallId: scopeKey }
	if (scopeType === 'actor') return { type: 'actor', actorId: scopeKey }
	return { type: 'global', name: scopeKey === 'archive' ? 'archive' : 'system' }
}

function parseOptionalInt(raw: string | null): number | undefined {
	if (!raw) return undefined
	const parsed = Number.parseInt(raw, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

function maxAfter(a: number, b: number): number {
	return Math.max(a, b)
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