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
	<div class="flex items-center gap-2 mb-4 shrink-0">
		<span class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">Intents</span>
	</div>
	<div class="space-y-0 flex-1 min-h-0 overflow-y-auto pr-1">
		{#each intents as intent, i (intent.id)}
			{@const { phase, label } = sidebarIntentPhase(intent)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				role="button"
				tabindex="0"
				class="group w-full text-left cursor-pointer border-b border-border py-4 transition-colors {selectedId === intent.id
					? 'bg-foreground/5 ring-1 ring-inset ring-foreground/10'
					: 'hover:bg-foreground/[0.03]'}"
				onclick={() => onSelect(intent.id)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						onSelect(intent.id)
					}
				}}
			>
				<div class="flex items-start gap-3">
					<span class="font-mono text-[10px] opacity-20 shrink-0 tabular-nums pt-0.5"
						>{(i + 1).toString().padStart(2, '0')}</span
					>
					<div class="min-w-0 flex-1 space-y-2">
						<p
							class="text-[15px] font-semibold tracking-tight leading-snug {intent.done
								? 'opacity-35 line-through'
								: ''}"
						>
							{intent.title}
						</p>
						<p class="text-[11px] opacity-55 leading-snug line-clamp-2">
							{intent.summary}
						</p>
						<span
							class="inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide {sidebarStatusBadgeClass(phase)}"
							>{label}</span
						>
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="shrink-0 pt-0.5"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
						role="group"
					>
						<button
							type="button"
							onclick={() => onRemove(intent.id)}
							class="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-foreground/45 hover:text-error rounded-md"
							aria-label="Remove intent"
						>
							<svg
								class="size-3.5"
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
			<p class="text-xs opacity-40 py-6">No intents yet. Use the composer below.</p>
		{/each}
	</div>
</section>
