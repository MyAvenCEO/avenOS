/** Shared mobile aside drawer + nav styling (Tauri iOS / narrow viewports). */

export const mobileAsidePanelClass =
	'border-border/60 bg-card/98 shadow-xl backdrop-blur-md transition-transform duration-200 ease-out'

export const mobileAsideWidthClass = 'w-full'

export const mobileAsideBackdropClass = 'fixed inset-0 bg-background/55 backdrop-blur-[2px]'

export const mobileAsideSectionLabelClass =
	'text-muted-foreground mb-2 text-[10px] font-bold tracking-[0.2em] uppercase md:mb-1 md:text-[9px]'

export const mobileAsideBottomPadClass = 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'

/**
 * Unified brand nav-item pill. Same language as the vibe-library Snippets nav:
 * outline-bordered rounded-full items; the active item is a brand-navy filled
 * pill. Identical on mobile and desktop (only sizing scales down at md+).
 */
function navPillBase(align: 'left' | 'right', size: 'lg' | 'md'): string {
	const alignClass = align === 'right' ? 'text-right' : 'text-left'
	const text = size === 'lg' ? 'text-[15px]' : 'text-[14px]'
	return `flex w-full items-center gap-2.5 rounded-full border px-3.5 py-2.5 ${text} font-medium leading-snug tracking-tight transition-colors touch-manipulation md:px-3 md:py-2 md:text-[13px] ${alignClass}`
}

export function mobileAsideNavLinkClass(active: boolean, align: 'left' | 'right' = 'left'): string {
	const base = navPillBase(align, 'lg')
	return active
		? `${base} border-primary bg-primary text-primary-foreground`
		: `${base} border-border text-foreground/80 hover:border-primary/40 hover:bg-accent/5`
}

export function mobileAsideNavLinkMutedClass(
	active: boolean,
	align: 'left' | 'right' = 'left'
): string {
	const base = navPillBase(align, 'md')
	return active
		? `${base} border-primary bg-primary text-primary-foreground`
		: `${base} border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/5 hover:text-foreground`
}

export function mobileAsideTextAlignClass(align: 'left' | 'right'): string {
	return align === 'right' ? 'text-right md:text-left' : 'text-left'
}
