/**
 * The hour of the in-game day, shared by every view.
 *
 * Kept in one place (and mirrored to localStorage) so the sandbox and the
 * world always show the same light — set dusk while styling a biome and the
 * island is at dusk when you go back to it.
 */
const STORAGE_KEY = 'avencity.hour'

const DEFAULT_HOUR = 11

function initial(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_HOUR
	const stored = localStorage.getItem(STORAGE_KEY)
	// a missing key reads as null, and Number(null) is 0 — which is a perfectly
	// valid hour, so the range check waved it through and every fresh browser
	// opened the island at midnight
	if (stored === null) return DEFAULT_HOUR
	const hour = Number(stored)
	return Number.isFinite(hour) && hour >= 0 && hour <= 24 ? hour : DEFAULT_HOUR
}

let hour = $state(initial())

export const timeOfDay = {
	get hour(): number {
		return hour
	},
	set hour(value: number) {
		hour = Math.max(0, Math.min(24, value))
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(hour))
	},
	/** "07:30" — for the slider label. */
	get label(): string {
		const h = Math.floor(hour) % 24
		const m = Math.round((hour - Math.floor(hour)) * 60)
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
	}
}
