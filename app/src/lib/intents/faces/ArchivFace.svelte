<script lang="ts">
import type { SkillRun } from '../mock-intents'

/**
 * Das Gesicht des Archiv-Skills: der Beleg, wie er abgelegt wurde — oder
 * die Datei, während sie noch geprüft wird. Menschlich gesprochen: "er
 * ist sicher, und hier liegt er."
 */
const { run }: { run: SkillRun } = $props()
const d = $derived(run.daten as { datei?: string; beleg?: string; ablage?: string; um?: string })
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-2.5">
		<span class="font-mono text-foreground/40 text-xs">▤</span>
		<span class="font-mono text-xs">{d.datei ?? '—'}</span>
		{#if run.zustand === 'laeuft'}
			<span class="text-[0.6875rem] text-status-working">wird gerade geprüft …</span>
		{/if}
	</div>
	{#if run.zustand === 'fertig'}
		<dl class="flex flex-col gap-1 text-xs">
			<div class="flex gap-3">
				<dt class="w-20 shrink-0 font-mono text-[0.625rem] text-foreground/40">Beleg</dt>
				<dd>{d.beleg}</dd>
			</div>
			<div class="flex gap-3">
				<dt class="w-20 shrink-0 font-mono text-[0.625rem] text-foreground/40">Ablage</dt>
				<dd>{d.ablage}</dd>
			</div>
			<div class="flex gap-3">
				<dt class="w-20 shrink-0 font-mono text-[0.625rem] text-foreground/40">Seit</dt>
				<dd>{d.um} · unveränderlich</dd>
			</div>
		</dl>
	{/if}
</div>
