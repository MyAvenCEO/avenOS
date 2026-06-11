<script lang="ts">
import type { Snippet } from 'svelte'

let {
	label = 'Technical details',
	children
}: {
	label?: string
	children: Snippet
} = $props()

let open = $state(false)
</script>

<div class="flex justify-end">
	<button
		type="button"
		class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors"
		aria-expanded={open}
		aria-label={open ? `Hide ${label}` : `Show ${label}`}
		onclick={() => {
			open = !open
		}}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="size-3.5 shrink-0 opacity-70"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
				clip-rule="evenodd"
			/>
		</svg>
		<span class="sr-only sm:not-sr-only">{label}</span>
	</button>
</div>

{#if open}
	<div
		class="text-muted-foreground mt-2 space-y-2 rounded-md border border-border/40 bg-background/50 px-3 py-2 text-[11px] leading-relaxed"
	>
		{@render children()}
	</div>
{/if}
