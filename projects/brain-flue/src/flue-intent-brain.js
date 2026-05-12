import { buildIntentPrompt } from './conversation-prompts';
import { flueIntentOutputSchema, normalizeFlueResponseData, validateIntentDecision } from './conversation-schemas';
import { toFlueBrainModelError } from './errors';
import { createIntentSessionName } from './session-names';
export function createFlueIntentBrain(input) {
    return {
        async decide({ state, envelope, availableSkills }) {
            const session = await input.harness.session(createIntentSessionName(state.intentId), {
                role: 'jaensen-conversation-intent'
            });
            const prompt = buildIntentPrompt({ state, envelope, availableSkills });
            try {
                const response = await session.prompt(prompt, {
                    schema: flueIntentOutputSchema,
                    role: 'jaensen-conversation-intent',
                    model: input.model,
                    thinkingLevel: input.thinkingLevel
                });
                return validateIntentDecision(normalizeFlueResponseData(response), {
                    state,
                    envelope,
                    availableSkillIds: new Set(availableSkills.map((skill) => skill.id))
                });
            }
            catch (error) {
                throw toFlueBrainModelError(`Flue intent decide failed for intent ${state.intentId}`, error);
            }
        }
    };
}
