<script lang="ts">
import { latestReserved, RESERVED_NAMES } from '$lib/reserved-names'

/**
 * The names already taken, under every avenID call to action. It renders
 * ONLY what `reserved-names.ts` really holds — when that list is empty this
 * component draws nothing at all, because an empty board is the truth and a
 * padded one is not.
 */
let { limit = 8 }: { limit?: number } = $props()

const names = $derived(latestReserved(limit))
const total = RESERVED_NAMES.length
</script>

{#if names.length > 0}
	<div class="mt-6">
		<p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
			Bereits vergeben · {total}
			{total === 1 ? 'Name' : 'Namen'}
		</p>
		<ul class="mt-3 flex flex-wrap gap-2">
			{#each names as name (name.slug)}
				<li
					class="inline-flex items-baseline gap-1.5 rounded-full border border-border/60 bg-surface-card px-3 py-1"
				>
					<span class="text-[13px] font-semibold tracking-tight text-foreground">{name.slug}</span>
					<span class="text-[11px] text-foreground/45">.aven.ceo</span>
					{#if name.holder}
						<span class="text-[11px] text-foreground/40">· {name.holder}</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="mt-3 text-[11px] leading-snug text-foreground/50">
			Jeden Namen gibt es genau einmal — ist er vergeben, ist er weg.
		</p>
	</div>
{/if}
