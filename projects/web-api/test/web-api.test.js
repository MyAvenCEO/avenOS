import { expect, test } from 'bun:test';
import { SqlitePersistence } from '@jaensen/persistence-sqlite';
import { createWebApi } from '../src/index';
test('POST /api/messages returns envelope and correlation ids, and intent endpoints expose runtime state', async () => {
    const persistence = new SqlitePersistence();
    const api = await createWebApi({
        persistence,
        harness: createHarnessStub(),
        skills: [],
        dispatcherBrain: {
            async route() {
                return {
                    type: 'create_intent',
                    title: 'Repo review',
                    initialGoal: 'Please review this repo',
                    reason: 'New user input'
                };
            }
        },
        intentBrain: {
            async decide({ state }) {
                return {
                    state,
                    actions: [{ type: 'reply_user', message: 'Starting review' }]
                };
            }
        },
        skillSupervisorBrain: {
            async decide() {
                return { state: {} };
            }
        },
        skillWorkerBrain: {
            async run() {
                return { state: {} };
            }
        }
    });
    try {
        const messageResponse = await fetch(`${api.url}api/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'please review this repo', attachments: [] })
        });
        expect(messageResponse.status).toBe(202);
        const messageBody = (await messageResponse.json());
        expect(typeof messageBody.envelopeId).toBe('string');
        expect(messageBody.correlationId).toBe(messageBody.envelopeId);
        await waitFor(async () => {
            const intentsResponse = await fetch(`${api.url}api/intents`);
            const body = (await intentsResponse.json());
            return body.intents[0]?.id ?? null;
        });
        const intentsResponse = await fetch(`${api.url}api/intents`);
        const intentsBody = (await intentsResponse.json());
        expect(intentsBody.intents).toHaveLength(1);
        expect(intentsBody.intents[0]).toMatchObject({
            title: 'Repo review',
            summary: 'Please review this repo',
            status: 'active'
        });
        const intentId = intentsBody.intents[0].id;
        const intentResponse = await fetch(`${api.url}api/intents/${intentId}`);
        const intentBody = (await intentResponse.json());
        expect(intentBody.id).toBe(intentId);
        const eventsResponse = await fetch(`${api.url}api/intents/${intentId}/events`);
        const eventsBody = (await eventsResponse.json());
        expect(eventsBody.events.some((event) => event.type === 'intent.created')).toBe(true);
        expect(eventsBody.events.some((event) => event.type === 'intent.message_to_user')).toBe(true);
    }
    finally {
        await api.stop();
    }
});
test('GET /api/events supports after cursors', async () => {
    const persistence = new SqlitePersistence();
    await persistence.migrate();
    await persistence.upsertActor({
        id: 'intent/demo',
        kind: 'intent',
        state: { intentId: 'demo', title: 'Demo', goal: 'Demo', status: 'active', summary: 'Demo', pendingSkillCalls: {} }
    });
    await persistence.enqueue({
        id: 'env-demo',
        fromActor: 'human',
        toActor: 'intent/demo',
        type: 'intent.start',
        correlationId: 'env-demo',
        payload: { intentId: 'demo' }
    });
    const api = await createWebApi({
        persistence,
        harness: createHarnessStub(),
        skills: [],
        dispatcherBrain: { async route() { throw new Error('unused'); } },
        intentBrain: { async decide() { throw new Error('unused'); } },
        skillSupervisorBrain: { async decide() { return { state: {} }; } },
        skillWorkerBrain: { async run() { return { state: {} }; } }
    });
    try {
        const allResponse = await fetch(`${api.url}api/events?scope=global`);
        const allBody = (await allResponse.json());
        const firstSeq = allBody.events[0]?.seq ?? 0;
        const afterResponse = await fetch(`${api.url}api/events?scope=global&after=${firstSeq}`);
        const afterBody = (await afterResponse.json());
        expect(afterBody.events.every((event) => event.seq > firstSeq)).toBe(true);
    }
    finally {
        await api.stop();
    }
});
function createHarnessStub() {
    return {
        async session() {
            return {
                async prompt() {
                    throw new Error('unexpected prompt');
                },
                async task() {
                    throw new Error('unexpected task');
                }
            };
        }
    };
}
async function waitFor(callback, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await callback();
        if (value !== null) {
            return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for condition');
}
