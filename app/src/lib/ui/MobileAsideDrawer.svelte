<script lang="ts">
	import type { Snippet } from 'svelte'
	import {
		mobileAsideBackdropClass,
		mobileAsideBottomPadClass,
		mobileAsidePanelClass,
		mobileAsideWidthClass,
		mobileAsideTextAlignClass,
	} from './mobile-aside'

	type Props = {
		open?: boolean
		side?: 'left' | 'right'
		ariaLabel: string
		/** Tailwind visibility class — drawer hidden from this breakpoint up. */
		hideFromClass?: string
		zIndex?: number
		/** Extra bottom padding above home indicator / composer FABs. */
		bottomPadClass?: string
		/** Pin header to top; nav body stays bottom-aligned. */
		header?: Snippet
		children: Snippet
		/** Pinned footer (e.g. self profile block in app nav). */
		footer?: Snippet
		onClose?: () => void
	}

	let {
		open = $bindable(false),
		side = 'left',
		ariaLabel,
		hideFromClass = 'md:hidden',
		zIndex = 50,
		bottomPadClass = mobileAsideBottomPadClass,
		header,
		children,
		footer,
		onClose,
	}: Props = $props()

	const align = $derived(side === 'right' ? 'right' : 'left')
	const slideClosedClass = $derived(
		side === 'left' ? '-translate-x-full pointer-events-none' : 'translate-x-full pointer-events-none',
	)
	const edgeClass = $derived(side === 'left' ? 'left-0 border-r' : 'right-0 border-l')
	const backdropZ = $derived(zIndex - 2)

	function close() {
		open = false
		onClose?.()
	}

	$effect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
</script>

{#if open}
	<button
		type="button"
		class="{mobileAsideBackdropClass} {hideFromClass}"
		style:z-index={backdropZ}
		aria-label="Close panel"
		onclick={close}
	></button>
{/if}

<aside
	class="fixed inset-y-0 z-50 flex min-h-0 flex-col px-4 {mobileAsidePanelClass} {mobileAsideWidthClass} {edgeClass} {hideFromClass} {mobileAsideTextAlignClass(align)}
		{open ? 'translate-x-0' : slideClosedClass}"
	style:z-index={zIndex}
	aria-label={ariaLabel}
	aria-hidden={!open}
>
	<div class="flex min-h-0 flex-1 flex-col pt-[max(0.75rem,env(safe-area-inset-top))]">
		{#if header}
			<div class="mb-3 shrink-0 {mobileAsideTextAlignClass(align)}">
				{@render header()}
			</div>
		{/if}

		<div
			class="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto {bottomPadClass}"
		>
			{@render children()}
		</div>

		{#if footer}
			<div
				class="border-border/60 shrink-0 border-t pt-4 {bottomPadClass} {mobileAsideTextAlignClass(align)}"
			>
				{@render footer()}
			</div>
		{/if}
	</div>
</aside>
