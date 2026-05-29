/**
 * Public API for skill data.
 * Components import from here — the internal loader + JSON structure can evolve freely.
 */
export type {
	AvenosSkill,
	AvenosSkillSlug,
	PublisherIdentityJson,
	PublisherWithSkills,
	SkillPublisher,
	SupportedLang,
} from './types'
export {
	allSlugs,
	avenmaiaSkillSlugs,
	aventinSkillSlugs,
	loadPublishersWithSkills,
	loadSkill as getAvenosSkill,
	loadSkills as avenosSkills,
	skillDetailHref,
} from './loader'

// Convenience: default DE export used by most pages
import { loadSkills } from './loader'
export const skills = loadSkills('de')
