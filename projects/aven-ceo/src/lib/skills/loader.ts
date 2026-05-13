import type {
	AvenosSkill,
	AvenosSkillSlug,
	PublisherIdentityJson,
	PublisherWithSkills,
	SkillJson,
	SkillPublisherId,
	SupportedLang,
} from './types'

// ── EN (source of truth) ──────────────────────────────────────────────────────
import enEmailIngestor from './content/en/email-ingestor.json'
import enDocumentExtractor from './content/en/document-extractor.json'
import enBrainMemorizer from './content/en/brain-memorizer.json'
import enBookKeeper from './content/en/book-keeper.json'
import enHumanReviewer from './content/en/human-reviewer.json'
import enBlogWriter from './content/en/blog-writer.json'
import enGoldenOffer from './content/en/golden-offer.json'

// ── DE ────────────────────────────────────────────────────────────────────────
import deEmailIngestor from './content/de/email-ingestor.json'
import deDocumentExtractor from './content/de/document-extractor.json'
import deBrainMemorizer from './content/de/brain-memorizer.json'
import deBookKeeper from './content/de/book-keeper.json'
import deHumanReviewer from './content/de/human-reviewer.json'
import deBlogWriter from './content/de/blog-writer.json'
import deGoldenOffer from './content/de/golden-offer.json'

// ── Publisher identities (per language) ───────────────────────────────────────
import enPubAvenos from './publishers/en/avenos.json'
import enPubAvenmaia from './publishers/en/avenmaia.json'
import dePubAvenos from './publishers/de/avenos.json'
import dePubAvenmaia from './publishers/de/avenmaia.json'

const registry: Record<SupportedLang, SkillJson[]> = {
	en: [
		enEmailIngestor,
		enDocumentExtractor,
		enBrainMemorizer,
		enBookKeeper,
		enHumanReviewer,
		enBlogWriter,
		enGoldenOffer,
	] as SkillJson[],
	de: [
		deEmailIngestor,
		deDocumentExtractor,
		deBrainMemorizer,
		deBookKeeper,
		deHumanReviewer,
		deBlogWriter,
		deGoldenOffer,
	] as SkillJson[],
}

const publisherRegistry: Record<SupportedLang, PublisherIdentityJson[]> = {
	en: [enPubAvenos, enPubAvenmaia] as PublisherIdentityJson[],
	de: [dePubAvenos, dePubAvenmaia] as PublisherIdentityJson[],
}

/** All slugs in declaration order. */
export const allSlugs: AvenosSkillSlug[] = registry.en.map((s) => s.slug)

/** Slugs for static routes under `/skills/avenos/[slug]`. */
export const avenosSkillSlugs: AvenosSkillSlug[] = registry.en
	.filter((s) => s.publisher.id === 'avenos')
	.map((s) => s.slug)

/** Slugs for static routes under `/skills/avenmaia/[slug]`. */
export const avenmaiaSkillSlugs: AvenosSkillSlug[] = registry.en
	.filter((s) => s.publisher.id === 'avenmaia')
	.map((s) => s.slug)

export function publisherIdentities(lang: SupportedLang = 'de'): PublisherIdentityJson[] {
	return publisherRegistry[lang] ?? publisherRegistry.en
}

export function publisherIdentity(id: SkillPublisherId, lang: SupportedLang = 'de'): PublisherIdentityJson {
	const list = publisherIdentities(lang)
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
			skillCount: skillsForPub.length,
		}
	})
}

export function loadSkills(lang: SupportedLang = 'de'): AvenosSkill[] {
	return registry[lang] ?? registry.en
}

/** Returns undefined for unknown slugs. Falls back to EN if lang file missing. */
export function loadSkill(slug: string, lang: SupportedLang = 'de'): AvenosSkill | undefined {
	return (registry[lang] ?? registry.en).find((s) => s.slug === slug)
}

/** Detail URL honoring publisher (`/skills/avenos/…` vs `/skills/avenmaia/…`). */
export function skillDetailHref(slug: string, lang: SupportedLang = 'de'): string {
	const skill = loadSkill(slug, lang)
	if (!skill) return '/skills'
	return `/skills/${skill.publisher.id}/${slug}`
}
