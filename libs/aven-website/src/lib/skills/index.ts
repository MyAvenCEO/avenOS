/**
 * Public API for skill data.
 * Components import from here — the internal loader + JSON structure can evolve freely.
 */

export {
	allSlugs,
	loadSkill as getAvenosSkill,
	loadSkills as avenosSkills,
	skillDetailHref
} from './loader'
export type { AvenosSkill, AvenosSkillSlug, SupportedLang } from './types'

// Convenience: default DE export used by most pages
import { loadSkills } from './loader'
export const skills = loadSkills('de')
