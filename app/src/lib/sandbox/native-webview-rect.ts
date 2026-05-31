/** Shared DOM → logical rect mapping for macOS child WKWebViews (vibes, vault, …). */

export const NATIVE_WEBVIEW_CLEARANCE_GAP_PX = 8

export function findNativeWebviewClearance(host: HTMLElement): HTMLElement | null {
	const root = host.closest('[data-native-webview-scope]') ?? document
	const clearance = root.querySelector('[data-native-webview-clearance]')
	if (!(clearance instanceof HTMLElement)) return null
	return clearance
}

export function nativeWebviewClearanceBottom(host: HTMLElement): number {
	const clearance = findNativeWebviewClearance(host)
	if (!clearance) return 0
	return Math.ceil(clearance.getBoundingClientRect().bottom + NATIVE_WEBVIEW_CLEARANCE_GAP_PX)
}

/**
 * Map host DOM rect → **logical/CSS** bounds for Tauri `LogicalPosition` / `LogicalSize`.
 * Clamps top edge below in-scope clearance markers (tab strips, headers, …).
 */
export function makeNativeWebviewRectMeasurer(host: HTMLElement) {
	return (): { x: number; y: number; w: number; h: number; minY: number } => {
		const r = host.getBoundingClientRect()
		const left = Math.floor(r.left)
		const clearanceBottom = nativeWebviewClearanceBottom(host)
		const top = Math.max(Math.floor(r.top), clearanceBottom)
		const right = Math.ceil(r.right)
		const bottom = Math.ceil(r.bottom)
		const w = Math.max(1, right - left)
		const h = Math.max(1, bottom - top)
		return { x: left, y: top, w, h, minY: clearanceBottom }
	}
}

/** Scroll containers between `host` and the viewport (aside panels, nested flex, etc.). */
export function collectNativeWebviewScrollTargets(host: HTMLElement): EventTarget[] {
	const out: EventTarget[] = []
	const seen = new Set<EventTarget>()
	let el: HTMLElement | null = host
	while (el) {
		const st = getComputedStyle(el)
		const oy = st.overflowY
		const ox = st.overflowX
		const yScroll = el.scrollHeight > el.clientHeight + 1
		const xScroll = el.scrollWidth > el.clientWidth + 1
		if (
			(yScroll && /^(auto|scroll|overlay)$/.test(oy)) ||
			(xScroll && /^(auto|scroll|overlay)$/.test(ox))
		) {
			if (!seen.has(el)) {
				seen.add(el)
				out.push(el)
			}
		}
		el = el.parentElement
	}
	if (!seen.has(window)) {
		out.push(window)
	}
	return out
}
