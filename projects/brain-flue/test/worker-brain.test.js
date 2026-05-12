import { expect, test } from 'bun:test';
import { createFlueSkillWorkerBrain } from '../src/index';
const baseSkill = {
    id: 'memory',
    path: 'memory/SKILL.md',
    description: 'Memory skill',
    frontmatter: { id: 'memory', description: 'Memory skill' },
    body: '# Memory\nRemember important facts.',
    bodyHash: 'hash-memory',
    loadedAt: '2026-05-12T00:00:00.000Z'
};
test('durable worker uses stable worker session', async () => {
    const calls = [];
    const brain = createFlueSkillWorkerBrain({
        harness: {
            async session(name) {
                calls.push(name);
                return {
                    async prompt() {
                        return { state: { persisted: true }, completed: true };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        },
        workspaceRoot: '/workspace'
    });
    const result = await brain.run({
        skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'durable' } },
        workerId: 'topic-jaensen-architecture',
        actorState: {},
        envelope: makeEnvelopeRecord()
    });
    expect(calls).toEqual(['actor/skill-worker/memory/topic-jaensen-architecture']);
    expect(result.state).toEqual({ persisted: true });
});
test('ephemeral worker uses task()', async () => {
    const calls = [];
    const brain = createFlueSkillWorkerBrain({
        harness: {
            async session(name) {
                calls.push({ type: 'session', value: name });
                return {
                    async prompt() {
                        throw new Error('unexpected prompt');
                    },
                    async task() {
                        calls.push({ type: 'task', value: 'called' });
                        return { state: { temp: true } };
                    }
                };
            }
        },
        workspaceRoot: '/workspace'
    });
    const result = await brain.run({
        skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'ephemeral' } },
        workerId: 'topic-jaensen-architecture',
        actorState: {},
        envelope: makeEnvelopeRecord()
    });
    expect(calls).toEqual([
        { type: 'session', value: 'actor/skill/memory' },
        { type: 'task', value: 'called' }
    ]);
    expect(result.state).toEqual({ temp: true });
});
test('worker accepts flue responses wrapped in data', async () => {
    const brain = createFlueSkillWorkerBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { data: { state: { persisted: true }, result: { ok: true }, completed: true } };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        },
        workspaceRoot: '/workspace'
    });
    await expect(brain.run({
        skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'durable' } },
        workerId: 'topic-jaensen-architecture',
        actorState: {},
        envelope: makeEnvelopeRecord()
    })).resolves.toMatchObject({ state: { persisted: true }, result: { ok: true }, completed: true });
});
function makeEnvelopeRecord(overrides = {}) {
    return {
        id: 'env-1',
        fromActor: 'skill/memory',
        toActor: 'skill-worker/memory/topic-jaensen-architecture',
        type: 'memory.remember',
        correlationId: 'corr-1',
        causationId: null,
        payload: {},
        status: 'queued',
        availableAt: '2026-05-12T00:00:00.000Z',
        attempts: 0,
        maxAttempts: 25,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
        ...overrides
    };
}
