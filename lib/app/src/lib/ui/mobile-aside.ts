/** Shared mobile aside drawer + nav styling (Tauri iOS / narrow viewports). */

export const mobileAsidePanelClass =
	'border-border/60 bg-card/98 shadow-xl backdrop-blur-md transition-transform duration-200 ease-out'

export const mobileAsideWidthClass = 'w-[90vw]'

export const mobileAsideBackdropClass =
	'fixed inset-0 bg-background/55 backdrop-blur-[2px]'

export const mobileAsideSectionLabelClass =
	'text-muted-foreground mb-2 text-[10px] font-bold tracking-[0.2em] uppercase md:mb-1 md:text-[9px]'

export const mobileAsideBottomPadClass =
	'pb-[max(0.75rem,env(safe-area-inset-bottom))]'

export function mobileAsideNavLinkClass(
	active: boolean,
	align: 'left' | 'right' = 'left',
): string {
	const alignClass =
		align === 'right' ? 'text-right md:text-left' : 'text-left'
	const base = `block w-full rounded-xl px-3.5 py-3 text-[15px] font-semibold leading-snug tracking-tight transition-colors touch-manipulation md:rounded-md md:px-3 md:py-1.5 md:text-[13px] ${alignClass}`
	return active
		? `${base} bg-accent/15 text-foreground md:font-medium`
		: `${base} text-muted-foreground hover:bg-accent/10 hover:text-foreground md:text-muted-foreground/70`
}

export function mobileAsideNavLinkMutedClass(
	active: boolean,
	align: 'left' | 'right' = 'left',
): string {
	const alignClass =
		align === 'right' ? 'text-right md:text-left' : 'text-left'
	const base = `block w-full rounded-xl px-3.5 py-2.5 text-[14px] font-medium leading-snug tracking-tight transition-colors touch-manipulation md:rounded-md md:px-3 md:py-1.5 md:text-[13px] ${alignClass}`
	return active
		? `${base} bg-accent/15 text-foreground`
		: `${base} text-muted-foreground hover:bg-accent/10 hover:text-foreground md:text-muted-foreground/70`
}

export function mobileAsideTextAlignClass(align: 'left' | 'right'): string {
	return align === 'right' ? 'text-right md:text-left' : 'text-left'
}
