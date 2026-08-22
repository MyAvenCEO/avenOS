/**
 * The address book — every Aven that is already live, personal and company
 * alike, in one shared namespace. Like `reserved-names.ts` this is the real
 * list: an entry means a running Aven with people behind it, never a
 * placeholder to make the page look busy.
 *
 * Skills reference the catalogue by slug so the page can say which are live
 * and which are still coming, from the same source the marketplace uses.
 * The free-text services are localised in `$lib/i18n/aven.ts`, keyed by slug.
 */

import type { AvenosSkillSlug } from './skills/types'

export type AvenKind = 'person' | 'company'

export interface LiveAven {
	/** The name in front of `.aven.ceo`. */
	slug: string
	/** How it is written: avenSAM, avenCEO. */
	name: string
	kind: AvenKind
	/** Who the Aven belongs to — a person or a company. */
	holder: string
	/** Which product it runs on. */
	plan: 'avenme' | 'avenceo'
	/** ISO date it went live. */
	since: string
	/** The skills it already runs, by catalogue slug. */
	skills: AvenosSkillSlug[]
}

const PERSONAL_SKILLS: AvenosSkillSlug[] = [
	'inbox-router',
	'email-manager',
	'docs-organizer',
	'brain-memorizer',
	'human-reviewer',
	'calendar-organizer',
	'todo-shuffler',
	'bookmark-champion'
]

const COMPANY_SKILLS: AvenosSkillSlug[] = [
	...PERSONAL_SKILLS,
	'book-keeper',
	'finance-brain',
	'website-creator',
	'checkout-builder',
	'blog-writer'
]

export const LIVE_AVENS: LiveAven[] = [
	{
		slug: 'ceo',
		name: 'avenCEO',
		kind: 'company',
		holder: 'avenCEO GmbH',
		plan: 'avenceo',
		since: '2026-01-01',
		skills: COMPANY_SKILLS
	},
	{
		slug: 'sam',
		name: 'avenSAM',
		kind: 'person',
		holder: 'Samuel Andert',
		plan: 'avenme',
		since: '2026-01-01',
		skills: PERSONAL_SKILLS
	},
	{
		slug: 'dan',
		name: 'avenDAN',
		kind: 'person',
		holder: 'Daniel Janz',
		plan: 'avenme',
		since: '2026-01-01',
		skills: PERSONAL_SKILLS
	}
]

export function avensOfKind(kind: AvenKind): LiveAven[] {
	return LIVE_AVENS.filter((a) => a.kind === kind)
}
