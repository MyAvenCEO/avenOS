import { toFlueBrainModelError } from './errors';
import { buildSupervisorPrompt } from './prompts';
import { skillSupervisorDecisionSchema, validateSupervisorDecision } from './schemas';
import { createSupervisorSessionName } from './session-names';
export function createFlueSkillSupervisorBrain(input) {
    return {
        async decide({ skill, actorState, envelope }) {
            const session = await input.harness.session(createSupervisorSessionName(skill.id), {
                role: 'jaensen-skill-supervisor'
            });
            const knownWorkers = readKnownWorkers(actorState);
            const prompt = buildSupervisorPrompt({
                skill,
                actorState,
                envelope,
                knownWorkers,
                workspaceRoot: input.workspaceRoot
            });
            try {
                const response = await session.prompt(prompt, {
                    schema: skillSupervisorDecisionSchema,
                    role: 'jaensen-skill-supervisor',
                    model: input.model,
                    thinkingLevel: input.thinkingLevel
                });
                return validateSupervisorDecision(readFlueData(response), envelope.fromActor);
            }
            catch (error) {
                throw toFlueBrainModelError(`Flue supervisor decision failed for skill ${skill.id}`, error);
            }
        }
    };
}
function readFlueData(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
        return value.data;
    }
    return value;
}
function readKnownWorkers(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return {};
    }
    const workers = state.workers;
    if (!workers || typeof workers !== 'object' || Array.isArray(workers)) {
        return {};
    }
    return workers;
}
