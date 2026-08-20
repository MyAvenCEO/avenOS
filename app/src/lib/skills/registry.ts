import { inboxSkill } from './inbox.skill'
import { abgleichSkill, brainSkill, calendarSkill, docsSkill } from './mocked.skills'
import type { SkillDef } from './skill'
import { todosSkill } from './todos.skill'

/**
 * The declared skills — the platform's catalog, all data. Adding a skill
 * is adding a config here; the canvas, the cross-skill doors, and the
 * boundary interfaces all derive. Todos is live; the rest are declared
 * templates (their full builds are cards 0154/0155/0157 of epic 0152) —
 * and the SAME templates back the skill instances in the Intents screen:
 * template and instance are one source.
 */
export const skills: SkillDef[] = [
	todosSkill,
	inboxSkill,
	docsSkill,
	calendarSkill,
	brainSkill,
	abgleichSkill
]

/** Template lookup by id — the intents workspace resolves instances here. */
export function skillById(id: string): SkillDef | undefined {
	return skills.find((s) => s.id === id)
}
