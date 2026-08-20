<script lang="ts">
import { fund, type SkillRun } from '../mock-intents'

/**
 * Die Signatur der Inbox: aus einem Dokument werden Zeilen. Das kleine
 * Bild links IST der Skill — ein Blatt, das zu strukturierten Feldern
 * wird; der Fakt daneben sagt, wie gut es gelang.
 */
const { run }: { run: SkillRun } = $props()
const fakt = $derived(fund<string>(run, 'fakt'))
</script>

<div class="flex items-center gap-3">
	<div class="flex shrink-0 items-center gap-1.5">
		<!-- Dokument … -->
		<div
			class="flex h-9 w-7 flex-col gap-[3px] rounded-[3px] border border-border-strong/60 p-[4px]"
		>
			<div class="h-[2px] w-full rounded bg-border-strong/70"></div>
			<div class="h-[2px] w-4/5 rounded bg-border-strong/70"></div>
			<div class="h-[2px] w-full rounded bg-border-strong/50"></div>
			<div class="h-[2px] w-3/5 rounded bg-border-strong/50"></div>
		</div>
		<span class="font-mono text-[0.625rem] text-foreground/35">→</span>
		<!-- … wird zu Feldern -->
		<div class="flex h-9 flex-col justify-center gap-[3px]">
			{#each [0, 1, 2] as i (i)}
				<div class="flex items-center gap-1">
					<div
						class="h-[5px] w-[5px] rounded-full {run.zustand === 'laeuft' && i === 2 ? 'bg-border' : 'bg-status-success/70'}"
					></div>
					<div
						class="h-[2px] w-9 rounded {run.zustand === 'laeuft' && i === 2 ? 'bg-border' : 'bg-border-strong/70'}"
					></div>
				</div>
			{/each}
		</div>
	</div>
	<p class="min-w-0 text-foreground/70 text-xs leading-snug">{fakt ?? '—'}</p>
</div>
