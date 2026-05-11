import type { IntentSkillBinding, SubAgent } from './types'

/** Primary = catalog path (e.g. `ingest/receipt_normalize`); secondary = id (e.g. `sk-ingest`). */
export function skillLinesForBinding(b: IntentSkillBinding): {
	primary: string
	secondary: string
} {
	return { primary: b.name, secondary: b.skillId }
}

export function skillLinesForSubAgent(
	sa: SubAgent,
	skills: IntentSkillBinding[]
): { primary: string; secondary: string } {
	if (sa.skillId) {
		const b = skills.find((s) => s.skillId === sa.skillId)
		if (b) return skillLinesForBinding(b)
	}
	return { primary: sa.role, secondary: sa.name }
}
