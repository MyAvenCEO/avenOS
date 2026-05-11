<script lang="ts">
import type { HitlTextReply } from '../types'

let {
	todo,
	onSubmit
}: {
	todo: HitlTextReply
	onSubmit: (text: string) => void
} = $props()

let value = $state('')

function submit() {
	onSubmit(value.trim())
	value = ''
}
</script>

<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20">
	<p class="text-xs font-bold uppercase opacity-40 tracking-wider">{todo.title}</p>
	<p class="text-sm leading-relaxed">{todo.question}</p>
	<input
		bind:value
		placeholder={todo.placeholder}
		class="w-full rounded-lg border border-border bg-background/80 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
	>
	<button
		type="button"
		class="self-start px-4 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase hover:bg-foreground hover:text-background transition-colors"
		onclick={submit}
	>
		Send to supervisor
	</button>
</div>
