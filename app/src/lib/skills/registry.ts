import { CATALOG, skillById as catalogEntry, reconcile, type SkillEntry } from '@avenos/aven-skills'
import { inboxSkill } from './inbox.skill'
import { abgleichSkill, brainSkill, calendarSkill, docsSkill } from './mocked.skills'
import type { SkillDef } from './skill'
import { todosSkill } from './todos.skill'

/**
 * The skills this app IMPLEMENTS — workflows, nodes, views. What a skill IS
 * (its name, its one-liner, the tier it comes with) lives in the shared
 * catalog, `@avenos/aven-skills`, which the marketing site reads from too.
 *
 * The split is deliberate: the app should not restate a display name the
 * website also owns, and the website should not carry workflow graphs. Two
 * facets, one identity. `libs/aven-skills/tests` fails if either side drifts.
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

/** What the shared catalog says about a skill: its name, tagline and tier. */
export function identityOf(id: string): SkillEntry | undefined {
	return catalogEntry(id)
}

/**
 * How this app's implementations line up against the catalog — `unknown` names
 * skills implemented here that the catalog has never heard of, `missing` names
 * catalog entries with no workflow yet (today: the announced ones, plus the
 * two the website sells that have no runtime).
 */
export function catalogCoverage() {
	return reconcile(skills.map((s) => s.id))
}

export { CATALOG }
