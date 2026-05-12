<script lang="ts">
import { sidebarIntentPhase, sidebarStatusBadgeClass } from './ceo-copy'
import type { IntentOrchestrator } from './types'

let {
	intents,
	selectedId,
	onSelect,
	onRemove
}: {
	intents: IntentOrchestrator[]
	selectedId: string | null
	onSelect: (id: string) => void
	onRemove: (id: string) => void
} = $props()
</script>

<section class="min-w-0 flex flex-col min-h-0">
	<div class="flex items-center gap-2 mb-1.5 shrink-0">
		<span class="text-[9px] font-bold opacity-30 uppercase tracking-[0.26em]">Intents</span>
	</div>
	<div class="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
		{#each intents as intent (intent.id)}
			{@const { phase, label } = sidebarIntentPhase(intent)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				role="button"
				tabindex="0"
				class="group w-full text-left cursor-pointer rounded-lg border px-3 py-2 transition-colors duration-150 ease-out {selectedId === intent.id
					? 'border-foreground/20 bg-background/90'
					: 'border-border/40 bg-background/40 hover:bg-background/70'}"
				onclick={() => onSelect(intent.id)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						onSelect(intent.id)
					}
				}}
			>
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1 space-y-0.5 pr-0.5">
						<p
							class="text-[13px] font-semibold tracking-tight leading-tight line-clamp-2 {intent.done
								? 'opacity-35 line-through'
								: ''}"
						>
							{intent.title}
						</p>
						<p class="text-[10px] opacity-50 leading-snug line-clamp-1">
							{intent.summary}
						</p>
					</div>
					<div
						class="shrink-0 flex flex-col items-end justify-center gap-1 self-stretch w-min min-w-17 pt-0.5"
					>
						<span
							class="inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-center leading-none {sidebarStatusBadgeClass(phase)}"
							>{label}</span
						>
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="shrink-0 -mr-0.5 -mt-0.5"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
						role="group"
					>
						<button
							type="button"
							onclick={() => onRemove(intent.id)}
							class="opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-1 text-foreground/45 hover:bg-foreground/5 hover:text-error"
							aria-label="Remove intent"
						>
							<svg
								class="size-3"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<p class="text-[11px] opacity-40 py-3">No intents yet. Use the composer below.</p>
		{/each}
	</div>
</section>
