import { expect, test } from 'bun:test';
import { createSupervisorSessionName, createWorkerSessionName, isSlugSafe } from '../src/index';
test('creates stable supervisor session name', () => {
    expect(createSupervisorSessionName('memory')).toBe('actor/skills/memory');
});
test('creates stable worker session name', () => {
    expect(createWorkerSessionName('memory', 'topic-jaensen-architecture')).toBe('actor/skills/memory/topic-jaensen-architecture');
});
test('validates slug-safe worker ids', () => {
    expect(isSlugSafe('job-01')).toBe(true);
    expect(isSlugSafe('Job_01')).toBe(false);
});
