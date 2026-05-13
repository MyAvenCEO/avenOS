import { expect, test } from 'bun:test';
import { FlueBrainValidationError, skillSupervisorDecisionSchema, skillWorkerResultSchema, validateSupervisorDecision, validateWorkerResult } from '../src/index';
test('invalid supervisor action is rejected', () => {
    expect(() => validateSupervisorDecision({
        state: {},
        actions: [{ type: 'explode', payload: {} }]
    }, 'intents/1')).toThrow(FlueBrainValidationError);
});
test('supervisor cannot send to human', () => {
    expect(() => validateSupervisorDecision({
        state: {},
        actions: [{ type: 'send', to: 'human', messageType: 'x', payload: {} }]
    }, 'intents/1')).toThrow('supervisor may not send to human');
    expect(() => validateSupervisorDecision({
        state: {},
        actions: [{ type: 'reply', messageType: 'x', payload: {} }]
    }, 'human')).toThrow('supervisor may not send to human');
});
test('worker result defaults missing state to empty object', () => {
    expect(validateWorkerResult({ result: { ok: true }, completed: true })).toMatchObject({ state: {}, result: { ok: true }, completed: true });
});
test('schemas reject malformed llm output', () => {
    expect(skillSupervisorDecisionSchema.safeParse({ state: {}, actions: [{ type: 'route_worker', workerId: 'bad id', messageType: '', payload: {} }] }).success).toBe(false);
    expect(skillWorkerResultSchema.safeParse({ result: {} }).success).toBe(true);
});
