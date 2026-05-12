import { z } from 'zod';
import { FlueBrainValidationError } from './errors';
import { isSlugSafe } from './session-names';
const eventSchema = z.object({
    eventType: z.string().min(1, 'eventType is required'),
    event: z.unknown()
});
const messageTypeSchema = z.string().trim().min(1, 'messageType must be non-empty');
const replyActionSchema = z.object({
    type: z.literal('reply'),
    messageType: messageTypeSchema,
    payload: z.unknown()
});
const sendActionSchema = z.object({
    type: z.literal('send'),
    to: z.string().trim().min(1, 'to is required'),
    messageType: messageTypeSchema,
    payload: z.unknown()
});
const routeWorkerActionSchema = z.object({
    type: z.literal('route_worker'),
    workerId: z.string().refine((value) => isSlugSafe(value), 'workerId must be slug-safe'),
    messageType: messageTypeSchema,
    payload: z.unknown()
});
const spawnWorkerActionSchema = z.object({
    type: z.literal('spawn_worker'),
    workerId: z.string().refine((value) => isSlugSafe(value), 'workerId must be slug-safe'),
    initialState: z.unknown().optional(),
    messageType: messageTypeSchema,
    payload: z.unknown()
});
export const skillSupervisorDecisionSchema = z.object({
    state: z.unknown(),
    events: z.array(eventSchema).optional(),
    actions: z.array(z.discriminatedUnion('type', [replyActionSchema, sendActionSchema, routeWorkerActionSchema, spawnWorkerActionSchema])).optional()
});
export const skillWorkerResultSchema = z.object({
    state: z.unknown(),
    events: z.array(eventSchema).optional(),
    result: z.unknown().optional(),
    completed: z.boolean().optional()
});
export function validateSupervisorDecision(input, envelopeFromActor) {
    const parsed = skillSupervisorDecisionSchema.safeParse(input);
    if (!parsed.success) {
        throw new FlueBrainValidationError(`Invalid supervisor decision: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    for (const action of parsed.data.actions ?? []) {
        if (action.type === 'send' && action.to === 'human') {
            throw new FlueBrainValidationError('Invalid supervisor decision: supervisor may not send to human');
        }
        if (action.type === 'reply' && envelopeFromActor === 'human') {
            throw new FlueBrainValidationError('Invalid supervisor decision: supervisor may not send to human');
        }
    }
    return parsed.data;
}
export function validateWorkerResult(input) {
    const parsed = skillWorkerResultSchema.safeParse(input);
    if (!parsed.success) {
        throw new FlueBrainValidationError(`Invalid worker result: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    return parsed.data;
}
