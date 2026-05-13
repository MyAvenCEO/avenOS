const SLUG_SAFE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function createSupervisorSessionName(skillId) {
    return `actor/skills/${skillId}`;
}
export function createWorkerSessionName(skillId, workerId) {
    return `actor/skills/${skillId}/${workerId}`;
}
export function createDispatcherSessionName() {
    return 'actor/dispatcher';
}
export function createIntentSessionName(intentId) {
    return `actor/intents/${intentId}`;
}
export function isSlugSafe(value) {
    return SLUG_SAFE_PATTERN.test(value);
}
