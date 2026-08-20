<script lang="ts">
import type { Schritt } from './mock-intents'

/**
 * DER geteilte Fortschritts-Baustein: jeder Skill-Lauf trägt ihn, egal
 * welches Gesicht darunter sitzt. Vier Zustände, mehr braucht kein Flow:
 * erledigt, dran, blockiert (wartet auf ein fremdes Ergebnis), offen.
 * Weil die Form überall gleich ist, liest ein Mensch JEDEN Skill gleich
 * — nur der Inhalt darunter wechselt.
 */
const { schritte }: { schritte: Schritt[] } = $props()

const MARK: Record<Schritt['zustand'], string> = {
	done: '✓',
	current: '◐',
	blocked: '◇',
	pending: '○'
}
const FARBE: Record<Schritt['zustand'], string> = {
	done: 'text-status-success',
	current: 'text-primary',
	blocked: 'text-status-working',
	pending: 'text-foreground/30'
}
</script>

<div class="flex items-center gap-2" role="list" aria-label="Fortschritt">
	{#each schritte as s, i (s.name)}
		{#if i > 0}
			<span class="h-px min-w-3 flex-1 bg-border"></span>
		{/if}
		<span role="listitem" class="flex shrink-0 items-baseline gap-1.5">
			<span class="font-mono text-[0.625rem] {FARBE[s.zustand]}">{MARK[s.zustand]}</span>
			<span
				class="text-[0.6875rem] {s.zustand === 'current'
					? 'font-medium text-foreground'
					: s.zustand === 'pending' || s.zustand === 'blocked'
						? 'text-foreground/40'
						: 'text-foreground/60'}"
			>
				{s.name}
			</span>
		</span>
	{/each}
</div>
