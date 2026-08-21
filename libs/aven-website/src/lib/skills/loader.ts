import { skillBySlug } from '@avenos/aven-skills'
import { PLANS, type Plan, type PlanId, plan as planById, planIncludes } from '$lib/pricing/plans'
import deBlogWriter from './content/de/blog-writer.json'
import deBookKeeper from './content/de/book-keeper.json'
import deBookmarkChampion from './content/de/bookmark-champion.json'
import deBrainMemorizer from './content/de/brain-memorizer.json'
import deCalendarOrganizer from './content/de/calendar-organizer.json'
import deCheckoutBuilder from './content/de/checkout-builder.json'
import deDocsOrganizer from './content/de/docs-organizer.json'
// ── DE ────────────────────────────────────────────────────────────────────────
import deEmailManager from './content/de/email-manager.json'
import deFinanceBrain from './content/de/finance-brain.json'
import deHumanReviewer from './content/de/human-reviewer.json'
import deInboxRouter from './content/de/inbox-router.json'
import deTodoShuffler from './content/de/todo-shuffler.json'
import deWebsiteCreator from './content/de/website-creator.json'
import enBlogWriter from './content/en/blog-writer.json'
import enBookKeeper from './content/en/book-keeper.json'
import enBookmarkChampion from './content/en/bookmark-champion.json'
import enBrainMemorizer from './content/en/brain-memorizer.json'
import enCalendarOrganizer from './content/en/calendar-organizer.json'
import enCheckoutBuilder from './content/en/checkout-builder.json'
import enDocsOrganizer from './content/en/docs-organizer.json'
// ── EN (source of truth) ──────────────────────────────────────────────────────
import enEmailManager from './content/en/email-manager.json'
import enFinanceBrain from './content/en/finance-brain.json'
import enHumanReviewer from './content/en/human-reviewer.json'
import enInboxRouter from './content/en/inbox-router.json'
import enTodoShuffler from './content/en/todo-shuffler.json'
import enWebsiteCreator from './content/en/website-creator.json'
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

/**
 * Which tier a skill comes with is decided ONCE, in the shared catalog that
 * the app reads too — not eight times over, in two languages. The content
 * files still carry a `plan`, because they are self-contained documents, but
 * the catalog is what wins: a JSON that disagrees is out of date, not right.
 */
function withCatalogPlan(list: SkillJson[]): SkillJson[] {
	return list.map((s) => {
		const entry = skillBySlug(s.slug)
		return entry ? { ...s, plan: entry.plan } : s
	})
}

const registry: Record<SupportedLang, SkillJson[]> = {
	en: withCatalogPlan([
		enInboxRouter,
		enEmailManager,
		enDocsOrganizer,
		enBrainMemorizer,
		enBookKeeper,
		enHumanReviewer,
		enCalendarOrganizer,
		enTodoShuffler,
		enBookmarkChampion,
		enFinanceBrain,
		enWebsiteCreator,
		enCheckoutBuilder,
		enBlogWriter
	] as SkillJson[]),
	de: withCatalogPlan([
		deInboxRouter,
		deEmailManager,
		deDocsOrganizer,
		deBrainMemorizer,
		deBookKeeper,
		deHumanReviewer,
		deCalendarOrganizer,
		deTodoShuffler,
		deBookmarkChampion,
		deFinanceBrain,
		deWebsiteCreator,
		deCheckoutBuilder,
		deBlogWriter
	] as SkillJson[])
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

/**
 * WHERE a skill is available, written from the plan data rather than from a
 * sentence typed into each JSON. Those sentences said "in jedem CEO-Plan
 * enthalten" and kept saying it through two pricing rewrites — a claim about
 * the plans that lived outside the plans. Now `plan` on the skill is the one
 * source and this is the only place the sentence exists.
 */
export function availabilityNote(skill: AvenosSkill, lang: SupportedLang = 'de'): string {
	const home = planById(skill.plan)
	const above = PLANS.filter((p) => planIncludes(p.id, skill.plan) && p.id !== skill.plan)
	const name = skillLabel(skill.slug)
	if (lang === 'en') {
		const inc = above.length > 0 ? ` — and in ${above.map((p) => p.name).join(' and ')}.` : '.'
		return skill.comingSoon
			? `${name} is coming with ${home.name}${inc} Still being built — you get it automatically the day it ships.`
			: `${name} is included in ${home.name}${inc} No surcharge, no separate licence.`
	}
	const inc = above.length > 0 ? ` — und in ${above.map((p) => p.name).join(' und ')}.` : '.'
	return skill.comingSoon
		? `${name} kommt mit ${home.name}${inc} Noch im Bau — du bekommst ihn automatisch, sobald er live ist.`
		: `${name} ist in ${home.name} enthalten${inc} Kein Aufpreis, keine zweite Lizenz.`
}

export function skillDetailHref(slug: string, lang: SupportedLang = 'de'): string {
	const skill = loadSkill(slug, lang)
	if (!skill) return '/skills'
	return `/skills/${skill.publisher.id}/${slug}`
}
