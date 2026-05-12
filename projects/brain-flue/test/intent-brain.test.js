import { expect, test } from 'bun:test';
import { FlueBrainValidationError, createFlueIntentBrain } from '../src/index';
test('intent uses actor/intent/<intentId> session', async () => {
    const calls = [];
    const brain = createFlueIntentBrain({
        harness: {
            async session(name) {
                calls.push(name);
                return {
                    async prompt() {
                        return {
                            state: makeIntentState(),
                            actions: [{ type: 'reply_user', message: 'hi' }]
                        };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() });
    expect(calls).toEqual(['actor/intent/intent-123']);
});
test('intent accepts call_skill for known skill', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return {
                            state: makeIntentState(),
                            actions: [{ type: 'call_skill', skillId: 'memory', callId: 'call-1', request: 'Remember this', payload: { text: 'hello' } }]
                        };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).resolves.toMatchObject({ actions: [{ type: 'call_skill', skillId: 'memory' }] });
});
test('intent rejects call_skill for unknown skill', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return {
                            state: makeIntentState(),
                            actions: [{ type: 'call_skill', skillId: 'missing', callId: 'call-1', request: 'Remember this', payload: {} }]
                        };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow('call_skill.skillId must exist in availableSkills');
});
test('intent rejects missing state', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { actions: [] };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow(FlueBrainValidationError);
});
test('intent rejects mismatched intentId', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { state: { ...makeIntentState(), intentId: 'intent-999' } };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow('state.intentId must match current actor state/envelope');
});
test('intent rejects ask_user unless waiting_for_user', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { state: makeIntentState('active'), actions: [{ type: 'ask_user', question: 'Need more info?' }] };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow('ask_user requires state.status = waiting_for_user');
});
test('intent rejects complete unless completed', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { state: makeIntentState('active'), actions: [{ type: 'complete', summary: 'Done' }] };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow('complete requires state.status = completed');
});
test('intent rejects fail unless failed', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return { state: makeIntentState('active'), actions: [{ type: 'fail', reason: 'Nope' }] };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).rejects.toThrow('fail requires state.status = failed');
});
test('Flue response .data is normalized before validation', async () => {
    const brain = createFlueIntentBrain({
        harness: {
            async session() {
                return {
                    async prompt() {
                        return {
                            data: {
                                state: makeIntentState(),
                                actions: [{ type: 'reply_user', message: 'Normalized' }]
                            }
                        };
                    },
                    async task() {
                        throw new Error('unexpected task');
                    }
                };
            }
        }
    });
    await expect(brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })).resolves.toMatchObject({ actions: [{ type: 'reply_user', message: 'Normalized' }] });
});
function makeIntentState(status = 'active') {
    return {
        intentId: 'intent-123',
        title: 'My intent',
        goal: 'Help the user',
        status,
        summary: 'Working',
        pendingSkillCalls: {}
    };
}
function makeSkills() {
    return [{ id: 'memory', description: 'Remember facts' }];
}
function makeEnvelopeRecord(overrides = {}) {
    return {
        id: 'env-1',
        fromActor: 'dispatcher',
        toActor: 'intent/intent-123',
        type: 'intent.user_input',
        correlationId: 'corr-1',
        causationId: null,
        payload: { text: 'hello' },
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
