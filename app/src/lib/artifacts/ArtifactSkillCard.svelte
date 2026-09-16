<script lang="ts">
import type { SkillPresentation } from '@avenos/actors/studio/presentation'

let {
	presentation,
	selected,
	committedAt,
	onselect
}: {
	presentation: SkillPresentation
	selected: boolean
	committedAt: string | null
	onselect: () => void
} = $props()

const path = $derived(presentation.steps.slice(0, 3).map((step) => step.label))
const overflow = $derived(Math.max(0, presentation.steps.length - 3))
</script>

<button
	type="button"
	onclick={onselect}
	aria-label={`Open Skill ${presentation.name}`}
	aria-pressed={selected}
	class="group flex min-h-48 flex-col overflow-hidden rounded-3xl border bg-surface-card p-4 text-left transition-colors hover:bg-surface-sunken focus:border-primary {selected ? 'border-primary' : 'border-border'}"
>
	<div class="flex items-center justify-between">
		<span
			aria-hidden="true"
			class="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary text-xl"
			>✳</span
		>
		<span
			class="rounded-full border border-border px-2 py-0.5 text-foreground/45 text-[length:var(--fs-micro)]"
			>Skill · v{presentation.version ?? '?'}</span
		>
	</div>
	<h2 class="mt-4 truncate font-semibold text-sm">{presentation.name}</h2>
	<div class="mt-2 flex flex-wrap gap-1 text-[length:var(--fs-micro)]">
		{#each presentation.inputs.slice(0, 2) as port}
			<span class="rounded-full bg-surface-sunken px-2 py-0.5 text-foreground/60"
				>{port.name}
				· {port.type}</span
			>
		{/each}
		<span aria-hidden="true" class="px-1 text-foreground/30">→</span>
		{#each presentation.outputs.slice(0, 2) as port}
			<span class="rounded-full bg-info-surface px-2 py-0.5 text-info-ink"
				>{port.name}
				· {port.type}</span
			>
		{/each}
	</div>
	{#if path.length}
		<p class="mt-3 truncate text-foreground/50 text-xs">
			{path.join(' → ')}{overflow ? ` · +${overflow}` : ''}
		</p>
	{:else if presentation.status !== 'valid'}
		<p class="mt-3 text-warning-ink text-xs">
			{presentation.status === 'malformed' ? 'Preview needs attention' : 'Unsupported version'}
		</p>
	{/if}
	{#if committedAt}
		<p class="mt-auto pt-3 text-foreground/35 text-[length:var(--fs-micro)]">
			{new Date(committedAt).toLocaleDateString()}
		</p>
	{/if}
</button>
