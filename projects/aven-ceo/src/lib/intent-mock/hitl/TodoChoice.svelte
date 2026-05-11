<script lang="ts">
import type { HitlChoice } from '../types'

let {
	todo,
	onPick
}: {
	todo: HitlChoice
	onPick: (optionId: string) => void
} = $props()
</script>

<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20">
	<p class="text-xs font-bold uppercase opacity-40 tracking-wider">{todo.title}</p>
	<p class="text-sm leading-relaxed">{todo.question}</p>
	<div class="flex flex-col gap-2">
		{#each todo.options as opt (opt.id)}
			<button
				type="button"
				class="text-left rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5 transition-colors"
				onclick={() => onPick(opt.id)}
			>
				{opt.label}
			</button>
		{/each}
	</div>
</div>
