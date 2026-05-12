const SLUG_SAFE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function createSupervisorSessionName(skillId) {
    return `actor/skill/${skillId}`;
}
export function createWorkerSessionName(skillId, workerId) {
    return `actor/skill-worker/${skillId}/${workerId}`;
}
export function createDispatcherSessionName() {
    return 'actor/dispatcher';
}
export function createIntentSessionName(intentId) {
    return `actor/intent/${intentId}`;
}
export function isSlugSafe(value) {
    return SLUG_SAFE_PATTERN.test(value);
}
