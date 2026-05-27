import { goto } from '$app/navigation'
import { browser } from '$app/environment'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

/** Max width aligned with Aven CEO orchestrator pages (composer + columns). */
export const contentMaxWidthClass = 'mx-auto w-full max-w-[min(100%,88rem)]'

/** Mobile bottom chrome — composer veil, corner FABs, and scroll clearance stay aligned. */
export const mobileFabBottomClass =
	'max-sm:bottom-[max(0.5rem,env(safe-area-inset-bottom))]'
export const mobileActionVeilClass =
	'max-sm:pt-1 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-sm:from-35%'
export const mobileMainBottomPadClass =
	'max-sm:pb-[calc(4.25rem+env(safe-area-inset-bottom))]'

/** In-app navigation — explicit `goto` so Tauri/WKWebView routes reliably (SvelteKit click delegation can miss). */
export function navigateAppTo(href: string): void {
	const tauri = browser && isTauriRuntime()
	void goto(href, {
		keepFocus: true,
		noScroll: false,
		...(tauri ? { invalidateAll: true } : {}),
	})
}

export function navigateApp(href: string, e?: MouseEvent): void {
	if (
		e &&
		(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || e.defaultPrevented)
	) {
		return
	}
	e?.preventDefault()
	navigateAppTo(href)
}
