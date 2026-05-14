export type AvenosSkillSlug =
	| 'email-ingestor'
	| 'document-extractor'
	| 'brain-memorizer'
	| 'book-keeper'
	| 'human-reviewer'
	| 'blog-writer'
	| 'golden-offer'

export type SkillPublisherId = 'aventin' | 'avenmaia'

export type SkillPublisher = {
	id: SkillPublisherId
	displayName: string // "AvenTin" | "AvenMaia"
	founderName: string // "Daniel" | "Samuel"
	scope: string // "Daniel Janz · aven.ceo"
}

/**
 * The shape of every language JSON file.
 * Non-localizable metadata (slug, publisher) lives here too so each file is self-contained.
 * Numbers (eurPerMonth, total) are intentionally in the language file — prices can differ by market.
 */
export type SkillJson = {
	slug: AvenosSkillSlug
	publisher: SkillPublisher
	oneLineCopy: string
	hero: {
		kicker: string
		headlineMain: string
		headlineSerifLead: string
		promiseHoursPerWeek: string
	}
	founderScenario: {
		timestamp: string
		story: string
	}
	benefits: string[]
	howSteps: string[]
	whatMechanics: {
		input: string
		magic: string
		output: string
	}
	playsWith: { slug: string; relation: string }[]
	valueStack: {
		standaloneAlternatives: { label: string; eurPerMonth: number }[]
		standaloneTotalEurPerMonth: number
		timeDelayToValue: string
		effortToInstall: string
		proof: string
	}
	bonuses: string[]
	scarcity: string
	letterFromPublisher: string
}

/** Language-resolved skill ready for Svelte components. */
export type AvenosSkill = SkillJson

export type SupportedLang = 'en' | 'de'

/** Marketplace / avatar identity — one JSON per publisher per language. */
export type PublisherIdentityJson = {
	id: SkillPublisherId
	displayName: string
	founderName: string
	scope: string
	/** Short line under the publisher name on the marketplace */
	subtitle: string
	/** Seed string for beam avatar SVG */
	beamAvatarLabel: string
	paletteCsv: string
	featuredSlugs: AvenosSkillSlug[]
}

export type PublisherWithSkills = PublisherIdentityJson & {
	skills: SkillJson[]
	skillCount: number
}
