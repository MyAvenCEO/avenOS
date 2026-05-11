<script lang="ts">
import type { HitlApproveReject } from '../types'

let {
	todo,
	onDecide
}: {
	todo: HitlApproveReject
	onDecide: (approved: boolean) => void
} = $props()
</script>

<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20">
	<p class="text-xs font-bold uppercase opacity-40 tracking-wider">{todo.title}</p>
	<p class="text-sm leading-relaxed opacity-90">{todo.summary}</p>
	<div class="flex gap-2">
		<button
			type="button"
			class="px-4 py-1.5 rounded-full bg-foreground text-background text-[10px] font-bold uppercase"
			onclick={() => onDecide(true)}
		>
			Approve
		</button>
		<button
			type="button"
			class="px-4 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase hover:bg-foreground hover:text-background transition-colors"
			onclick={() => onDecide(false)}
		>
			Reject
		</button>
	</div>
</div>
