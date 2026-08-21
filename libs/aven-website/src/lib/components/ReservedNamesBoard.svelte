<script lang="ts">
import { nextPosition, reservedInOrder } from '$lib/reserved-names'

/**
 * The waiting list itself, under every avenID call to action — in order,
 * because the order IS the offer: whoever stands first, founds first. The
 * open row at the bottom is the reader's place, and it is a real number
 * (one past the last name actually taken), not a countdown dressed up as
 * scarcity.
 *
 * It renders ONLY what `reserved-names.ts` really holds; with an empty list
 * this draws nothing, because an empty queue is the truth and a padded one
 * is not.
 */
let { limit = 6 }: { limit?: number } = $props()

const taken = $derived(reservedInOrder())
/** Show the head of the queue; a long list keeps its first places visible. */
const shown = $derived(taken.slice(0, limit))
const hidden = $derived(taken.length - shown.length)
</script>

{#if taken.length > 0}
	<div class="mt-6 border-t border-border/50 pt-5">
		<p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
			Warteliste · Platz {nextPosition()} ist frei
		</p>
		<ol class="mt-3 space-y-1.5">
			{#each shown as name, i (name.slug)}
				<li class="flex items-baseline gap-3 text-[13px]">
					<span class="w-6 shrink-0 text-right font-semibold tabular-nums text-foreground/40">
						{i + 1}
					</span>
					<span class="font-semibold tracking-tight text-foreground">{name.slug}</span>
					<span class="text-[11px] text-foreground/45">.aven.ceo</span>
					{#if name.holder}
						<span class="ml-auto text-[11px] text-foreground/40">{name.holder}</span>
					{/if}
				</li>
			{/each}
			{#if hidden > 0}
				<li class="flex items-baseline gap-3 text-[12px] text-foreground/45">
					<span class="w-6 shrink-0 text-right tabular-nums">⋮</span>
					<span>und {hidden} weitere</span>
				</li>
			{/if}
			<li
				class="flex items-baseline gap-3 rounded-lg border border-dashed border-accent/60 bg-accent/8 px-2 py-1.5 text-[13px]"
			>
				<span class="w-6 shrink-0 text-right font-semibold tabular-nums text-accent">
					{nextPosition()}
				</span>
				<span class="font-semibold tracking-tight text-foreground/70">dein Name</span>
				<span class="text-[11px] text-foreground/45">.aven.ceo</span>
				<span class="ml-auto text-[11px] font-medium text-accent">frei</span>
			</li>
		</ol>
		<p class="mt-3 text-[11px] leading-snug text-foreground/50">
			Wer zuerst steht, gründet zuerst — und jeden Namen gibt es genau einmal.
		</p>
	</div>
{/if}
