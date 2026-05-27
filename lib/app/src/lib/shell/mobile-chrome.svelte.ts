/** Page-level overrides for root mobile shell FABs (profile nav, page aside). */
export type MobileChromeOverrides = {
	hideProfile?: boolean
	hideAsideNav?: boolean
}

let overrides = $state<MobileChromeOverrides>({})

export function setMobileChromeOverrides(next: MobileChromeOverrides) {
	overrides = next
}

export function clearMobileChromeOverrides() {
	overrides = {}
}

export function mobileChromeOverrides() {
	return overrides
}
