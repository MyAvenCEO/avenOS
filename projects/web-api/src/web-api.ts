import {
	asSqlitePersistence,
	createAppNode,
	type AppNode,
	type CreateAppNodeInput
} from '@jaensen/app-node'
import type { UserAttachment } from '@jaensen/conversation-actors'
import type { StreamEventRecord } from '@jaensen/persistence-sqlite'

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
}

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
	const app = await createAppNode(input)
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

		daemonPromise = (async () => {
			while (daemonRunning) {
				const result = await app.tick()
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
		}
	}

	const server = Bun.serve({
		port: input.port ?? 0,
		hostname: input.hostname ?? '127.0.0.1',
		idleTimeout: input.idleTimeoutSeconds ?? 30,
		fetch(request) {
			return routeRequest({ request, app, persistence, pollIntervalMs, streamHeartbeatMs })
		}
	})

	startDaemon()

	return {
		app,
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
	persistence: SqliteQueryable
	pollIntervalMs: number
	streamHeartbeatMs: number
}): Promise<Response> {
	const url = new URL(input.request.url)
	const path = trimTrailingSlash(url.pathname)

	if (input.request.method === 'POST' && path === '/api/messages') {
		return handlePostMessages(input.request, input.app)
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
		const events = await input.persistence.listStreamEvents({ scope: `intent/${intentId}`, after })
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

	return notFound(`No route for ${input.request.method} ${path}`)
}

async function handlePostMessages(request: Request, app: AppNode): Promise<Response> {
	const payload = await request.json().catch(() => null)
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return badRequest('Body must be a JSON object')
	}

	const text = typeof payload.text === 'string' ? payload.text.trim() : ''
	if (!text) {
		return badRequest('text is required')
	}

	const attachments = normalizeAttachments((payload as Record<string, unknown>).attachments)
	const result = await app.enqueueUserInput({ text, attachments })
	return jsonResponse(result, { status: 202 })
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

function normalizeAttachments(value: unknown): UserAttachment[] {
	if (!Array.isArray(value)) {
		return []
	}

	return value.flatMap((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return []
		}

		const record = item as Record<string, unknown>
		if (typeof record.id !== 'string' || record.id.length === 0) {
			return []
		}

		return [
			{
				id: record.id,
				path: typeof record.path === 'string' ? record.path : undefined,
				mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
				name: typeof record.name === 'string' ? record.name : undefined
			}
		]
	})
}

function parseAfter(value: string | null): number {
	if (!value) {
		return 0
	}

	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
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