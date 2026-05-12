import { SkillNotFoundError } from './errors'
import type { SkillDefinition, SkillRegistry } from './types'

export function createSkillRegistry(skills: SkillDefinition[]): SkillRegistry {
	const byId = new Map(skills.map((skill) => [skill.id, skill] as const))

	return {
		list(): SkillDefinition[] {
			return [...skills]
		},
		get(id: string): SkillDefinition | null {
			return byId.get(id) ?? null
		},
		require(id: string): SkillDefinition {
			const skill = byId.get(id)
			if (!skill) {
				throw new SkillNotFoundError(id)
			}

			return skill
		}
	}
}