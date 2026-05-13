import { asSqlitePersistence, createAppNode } from '@jaensen/app-node';
export async function createWebApi(input) {
    const app = await createAppNode(input);
    const persistence = asQueryablePersistence(app);
    const pollIntervalMs = input.pollIntervalMs ?? 150;
    const idleDelayMs = input.idleDelayMs ?? 100;
    let daemonRunning = true;
    let daemonPromise = null;
    function startDaemon() {
        if (daemonPromise) {
            return;
        }
        daemonPromise = (async () => {
            while (daemonRunning) {
                const result = await app.tick();
                if (result === 'idle') {
                    await sleep(idleDelayMs);
                }
            }
        })();
    }
    async function stopDaemon() {
        daemonRunning = false;
        if (daemonPromise) {
            await daemonPromise;
        }
    }
    const server = Bun.serve({
        port: input.port ?? 0,
        hostname: input.hostname ?? '127.0.0.1',
        fetch(request) {
            return routeRequest({ request, app, persistence, pollIntervalMs });
        }
    });
    startDaemon();
    return {
        app,
        port: server.port,
        hostname: server.url.hostname,
        url: server.url.toString(),
        server,
        startDaemon,
        stopDaemon,
        async stop() {
            server.stop(true);
            await stopDaemon();
        }
    };
}
async function routeRequest(input) {
    const url = new URL(input.request.url);
    const path = trimTrailingSlash(url.pathname);
    if (input.request.method === 'POST' && path === '/api/messages') {
        return handlePostMessages(input.request, input.app);
    }
    if (input.request.method === 'GET' && path === '/api/intents') {
        return jsonResponse({ intents: (await input.persistence.listIntents()).map(mapIntentRecord) });
    }
    if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+$/.test(path)) {
        const intentId = decodeURIComponent(path.split('/')[3] ?? '');
        const intent = await input.persistence.getIntent(intentId);
        return intent ? jsonResponse(mapIntentRecord(intent)) : notFound(`Intent ${intentId} not found`);
    }
    if (input.request.method === 'GET' && /^\/api\/intents\/[^/]+\/events$/.test(path)) {
        const intentId = decodeURIComponent(path.split('/')[3] ?? '');
        const after = parseAfter(url.searchParams.get('after'));
        const events = await input.persistence.listStreamEvents({ scope: `intents/${intentId}`, after });
        return jsonResponse({ events });
    }
    if (input.request.method === 'GET' && path === '/api/events') {
        const scope = url.searchParams.get('scope');
        if (!scope) {
            return badRequest('Missing scope');
        }
        const after = parseAfter(url.searchParams.get('after'));
        const events = await input.persistence.listStreamEvents({ scope, after });
        return jsonResponse({ events });
    }
    if (input.request.method === 'GET' && path === '/api/events/stream') {
        const scope = url.searchParams.get('scope');
        if (!scope) {
            return badRequest('Missing scope');
        }
        const after = maxAfter(parseAfter(url.searchParams.get('after')), parseAfter(input.request.headers.get('last-event-id')));
        return createEventStreamResponse({
            persistence: input.persistence,
            scope,
            after,
            pollIntervalMs: input.pollIntervalMs,
            signal: input.request.signal
        });
    }
    return notFound(`No route for ${input.request.method} ${path}`);
}
async function handlePostMessages(request, app) {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return badRequest('Body must be a JSON object');
    }
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
        return badRequest('text is required');
    }
    const attachments = normalizeAttachments(payload.attachments);
    const result = await app.enqueueUserInput({ text, attachments });
    return jsonResponse(result, { status: 202 });
}
function createEventStreamResponse(input) {
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
        async start(controller) {
            let cursor = input.after;
            controller.enqueue(encoder.encode(`retry: ${input.pollIntervalMs}\n\n`));
            const abort = () => {
                closed = true;
                try {
                    controller.close();
                }
                catch {
                    // ignore close races
                }
            };
            input.signal.addEventListener('abort', abort, { once: true });
            try {
                while (!closed && !input.signal.aborted) {
                    const events = await input.persistence.listStreamEvents({
                        scope: input.scope,
                        after: cursor,
                        limit: 200
                    });
                    if (events.length === 0) {
                        await sleep(input.pollIntervalMs);
                        continue;
                    }
                    for (const event of events) {
                        cursor = event.seq;
                        controller.enqueue(encoder.encode(formatSseEvent(event)));
                    }
                }
            }
            finally {
                input.signal.removeEventListener('abort', abort);
                if (!closed) {
                    abort();
                }
            }
        }
    });
    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive'
        }
    });
}
function formatSseEvent(event) {
    return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}
function mapIntentRecord(intent) {
    const state = toRecord(intent.state);
    return {
        id: intent.id,
        title: readOptionalString(state.title),
        goal: readOptionalString(state.goal),
        status: readOptionalString(state.status),
        summary: readOptionalString(state.summary),
        pendingSkillCalls: state.pendingSkillCalls && typeof state.pendingSkillCalls === 'object' && !Array.isArray(state.pendingSkillCalls)
            ? state.pendingSkillCalls
            : {},
        version: intent.version,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
        state: intent.state
    };
}
function asQueryablePersistence(app) {
    const persistence = asSqlitePersistence(app.persistence);
    if (!persistence) {
        throw new TypeError('@jaensen/web-api requires SqlitePersistence-backed app-node persistence');
    }
    return persistence;
}
function normalizeAttachments(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return [];
        }
        const record = item;
        if (typeof record.id !== 'string' || record.id.length === 0) {
            return [];
        }
        return [
            {
                id: record.id,
                path: typeof record.path === 'string' ? record.path : undefined,
                mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
                name: typeof record.name === 'string' ? record.name : undefined
            }
        ];
    });
}
function parseAfter(value) {
    if (!value) {
        return 0;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function maxAfter(a, b) {
    return Math.max(a, b);
}
function trimTrailingSlash(pathname) {
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}
function toRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function readOptionalString(value) {
    return typeof value === 'string' ? value : null;
}
function jsonResponse(body, init) {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            ...(init?.headers ?? {})
        }
    });
}
function badRequest(message) {
    return jsonResponse({ error: message }, { status: 400 });
}
function notFound(message) {
    return jsonResponse({ error: message }, { status: 404 });
}
async function sleep(milliseconds) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
