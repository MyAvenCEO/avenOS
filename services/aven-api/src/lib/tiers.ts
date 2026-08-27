/**
 * The tiers a visitor can arrive from, and how to greet each one.
 *
 * Tier IDENTITY — the ids and their display names — now comes from the
 * `@myavenceo/aven-ceo` package SSOT (`@myavenceo/aven-ceo/pricing`), so this
 * file never keeps its own copy of a tier's id or name: `TierId`/`TIER_IDS`
 * derive from `PlanId`/`planOrder`, and each greeting's `name` is read straight
 * from `plan(id).name`. PRICES are still deliberately kept OUT — the two apps
 * build separately, and a stale copy of prices is worse than no copy at all.
 * Only the funnel-specific `lead` copy lives here: it is about waitlist
 * mechanics, not part of the pricing SSOT.
 */
import { type PlanId, plan, planOrder } from '@myavenceo/aven-ceo/pricing'

export type TierId = PlanId

export const TIER_IDS: TierId[] = planOrder

export interface TierGreeting {
	name: string
	/** Why securing your place is the way into THIS tier. */
	lead: string
}

/** The funnel `lead` prose per tier — waitlist mechanics, authored in German,
 * kept local on purpose. Names are NOT stored here; they come from
 * `plan(id).name`. Keyed partially so a tier the package still carries but the
 * funnel does not greet (or a tier removed upstream) simply yields no
 * greeting. */
const LEADS: Partial<Record<TierId, string>> = {
	avenid:
		'Die Testride sichert dir deinen avenCEO‑Namen für ein Jahr — plus eine einstündige Testfahrt nach deiner Einladung. Zugleich ist sie dein Platz auf der Warteliste: Eingeladen wird der Reihe nach.',
	avenceo:
		'avenCEO startet invite‑only. Deinen Platz sicherst du dir über deine Testride: Der Name gehört dir, und die Reihenfolge der Warteliste ist die Reihenfolge der Einladungen.',
	avencoop:
		'avenCOOP vergeben wir nach Passung, nicht der Reihe nach — wir steigen als technischer Co‑Founder bei dir ein. Der Weg dahin führt trotzdem über deine Testride: Sie hält deinen Platz und zeigt uns, dass es dir ernst ist.'
}

export function tierFrom(url: URL): TierId | null {
	const raw = url.searchParams.get('tier')
	return TIER_IDS.includes(raw as TierId) ? (raw as TierId) : null
}

export function greetingFor(tier: TierId | null): TierGreeting | null {
	if (!tier) return null
	const lead = LEADS[tier]
	if (!lead) return null
	return { name: plan(tier).name, lead }
}
