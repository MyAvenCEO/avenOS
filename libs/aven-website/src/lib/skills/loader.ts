import { PLANS, type Plan, type PlanId, planIncludes } from '$lib/pricing/plans'
import deBlogWriter from './content/de/blog-writer.json'
import deBookKeeper from './content/de/book-keeper.json'
import deBrainMemorizer from './content/de/brain-memorizer.json'
import deDocsOrganizer from './content/de/docs-organizer.json'
// ── DE ────────────────────────────────────────────────────────────────────────
import deEmailIngestor from './content/de/email-ingestor.json'
import deHumanReviewer from './content/de/human-reviewer.json'
import enBlogWriter from './content/en/blog-writer.json'
import enBookKeeper from './content/en/book-keeper.json'
import enBrainMemorizer from './content/en/brain-memorizer.json'
import enDocsOrganizer from './content/en/docs-organizer.json'
// ── EN (source of truth) ──────────────────────────────────────────────────────
import enEmailIngestor from './content/en/email-ingestor.json'
import enHumanReviewer from './content/en/human-reviewer.json'
import dePubAvenmaia from './publishers/de/avenmaia.json'
import dePubAventin from './publishers/de/aventin.json'
import enPubAvenmaia from './publishers/en/avenmaia.json'
// ── Publisher identities (per language) ───────────────────────────────────────
import enPubAventin from './publishers/en/aventin.json'
import type {
	AvenosSkill,
	AvenosSkillSlug,
	PublisherIdentityJson,
	PublisherWithSkills,
	SkillJson,
	SkillPublisherId,
	SupportedLang
} from './types'

const registry: Record<SupportedLang, SkillJson[]> = {
	en: [
		enEmailIngestor,
		enDocsOrganizer,
		enBrainMemorizer,
		enBookKeeper,
		enHumanReviewer,
		enBlogWriter
	] as SkillJson[],
	de: [
		deEmailIngestor,
		deDocsOrganizer,
		deBrainMemorizer,
		deBookKeeper,
		deHumanReviewer,
		deBlogWriter
	] as SkillJson[]
}

const publisherRegistry: Record<SupportedLang, PublisherIdentityJson[]> = {
	en: [enPubAventin, enPubAvenmaia] as PublisherIdentityJson[],
	de: [dePubAventin, dePubAvenmaia] as PublisherIdentityJson[]
}

/** All slugs in declaration order. */
export const allSlugs: AvenosSkillSlug[] = registry.en.map((s) => s.slug)

/** Slugs for static routes under `/skills/aventin/[slug]`. */
export const aventinSkillSlugs: AvenosSkillSlug[] = registry.en
	.filter((s) => s.publisher.id === 'aventin')
	.map((s) => s.slug)

/** Slugs for static routes under `/skills/avenmaia/[slug]`. */
export const avenmaiaSkillSlugs: AvenosSkillSlug[] = registry.en
	.filter((s) => s.publisher.id === 'avenmaia')
	.map((s) => s.slug)

export function publisherIdentities(lang: SupportedLang = 'de'): PublisherIdentityJson[] {
	return publisherRegistry[lang] ?? publisherRegistry.en
}

export function publisherIdentity(
	id: SkillPublisherId,
	lang: SupportedLang = 'de'
): PublisherIdentityJson {
	const list = publisherIdentities(lang)
	// biome-ignore lint/style/noNonNullAssertion: the en registry is the static, complete fallback — every id resolvable by construction.
	return list.find((p) => p.id === id) ?? publisherRegistry.en.find((p) => p.id === id)!
}

/** Publishers merged with live skill counts from the skill registry (auto‑filled). */
export function loadPublishersWithSkills(lang: SupportedLang = 'de'): PublisherWithSkills[] {
	const list = registry[lang] ?? registry.en
	return publisherIdentities(lang).map((p) => {
		const skillsForPub = list.filter((s) => s.publisher.id === p.id)
		return {
			...p,
			skills: skillsForPub,
			skillCount: skillsForPub.length
		}
	})
}

export function loadSkills(lang: SupportedLang = 'de'): AvenosSkill[] {
	return registry[lang] ?? registry.en
}

/**
 * Skills grouped by the plan they come with, in plan order — the marketplace's
 * organizing axis. Buyers ask "what do I get for this price", not "who wrote
 * it", so the publisher stays as attribution on the card and nothing more.
 */
export function loadSkillsByPlan(
	lang: SupportedLang = 'de'
): { plan: Plan; skills: AvenosSkill[] }[] {
	const list = registry[lang] ?? registry.en
	return PLANS.map((p) => ({ plan: p, skills: list.filter((s) => s.plan === p.id) }))
}

/** Everything a plan includes — its own skills plus every tier below it. */
export function skillsIncludedIn(planId: PlanId, lang: SupportedLang = 'de'): AvenosSkill[] {
	return (registry[lang] ?? registry.en).filter((s) => planIncludes(planId, s.plan))
}

/** Returns undefined for unknown slugs. Falls back to EN if lang file missing. */
export function loadSkill(slug: string, lang: SupportedLang = 'de'): AvenosSkill | undefined {
	return (registry[lang] ?? registry.en).find((s) => s.slug === slug)
}

/** Detail URL honoring publisher (`/skills/aventin/…` vs `/skills/avenmaia/…`). */
/**
 * How a skill's name is written for humans: no hyphens. The slug stays
 * hyphenated because it is a URL segment and a file name — but nothing the
 * reader sees should look like one, so every surface that prints a skill
 * name goes through here.
 */
export function skillLabel(slug: string): string {
	return slug.replaceAll('-', ' ')
}

export function skillDetailHref(slug: string, lang: SupportedLang = 'de'): string {
	const skill = loadSkill(slug, lang)
	if (!skill) return '/skills'
	return `/skills/${skill.publisher.id}/${slug}`
}
