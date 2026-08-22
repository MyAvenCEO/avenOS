import type { PlanId } from '$lib/pricing/plans'

export type AvenosSkillSlug =
	| 'email-manager'
	| 'inbox-router'
	| 'bookmark-champion'
	| 'calendar-organizer'
	| 'todo-shuffler'
	| 'docs-organizer'
	| 'brain-memorizer'
	| 'book-keeper'
	| 'human-reviewer'
	| 'finance-brain'
	| 'website-creator'
	| 'checkout-builder'
	| 'blog-writer'

/**
 * The shape of every language JSON file.
 * Non-localizable metadata (slug, plan) lives here too so each file is self-contained.
 * Skills are global — there is no publisher; every skill belongs to the one catalogue.
 * Numbers (eurPerMonth, total) are intentionally in the language file — prices can differ by market.
 */
export type SkillJson = {
	slug: AvenosSkillSlug
	/** Not shipped yet — the catalogue shows it, flagged, and nobody is sold it. */
	comingSoon?: boolean
	/** The plan this skill first comes with; higher plans include it too. */
	plan: PlanId
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
	letterFromPublisher: string
}

/** Language-resolved skill ready for Svelte components. */
export type AvenosSkill = SkillJson

export type SupportedLang = 'en' | 'de'
