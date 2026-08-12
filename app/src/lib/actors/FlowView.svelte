<script lang="ts">
import AvenUiView from './AvenUiView.svelte'
import type { Actor } from './actor'
import { bus } from './bus'

/**
 * The generic flow window (0137): host chrome around actor faces. The
 * stepper and the terminal cards (failure, staged actions) come from the
 * FLOW actor's state; the content below is always the ACTIVE (or tapped)
 * STEP ACTOR'S OWN VIEW — each step keeps its face, the flow only frames
 * them. Tapping a done step shows its committed view; tapping again
 * returns to the live one.
 */
const { actor }: { actor: Actor } = $props()

interface StepRow {
	mark: string
	label: string
	actor: string
	index: number
}

const stepRows = $derived((actor.state?.stepRows as StepRow[]) ?? [])
const viewStep = $derived(Number(actor.state?.viewStep ?? -1))
const goalRows = $derived((actor.state?.goalRows as { quote: string }[]) ?? [])
/** ALL round failures, live during the run — not only the final obituary. */
const history = $derived((actor.state?.history as { error: string; excerpt: string }[]) ?? [])
const produced = $derived((actor.state?.producedRows as { id: string; status: string }[]) ?? [])
const phase = $derived(String(actor.state?.phase ?? 'idle'))
const stepActor = $derived(bus.get(String(actor.state?.activeStep ?? '')))
/**
 * The displayed step's RECORD in flow data — the parsed JSON the model's
 * round actually produced (proofs, verdict, the whole draft). One
 * disclosure per step: the face above, the machine truth below.
 */
const stepRecord = $derived.by(() => {
	const data = actor.state?.data as Record<string, unknown> | undefined
	return data?.[String(actor.state?.activeStep ?? '')]
})
let showJson = $state(false)

function tap(row: StepRow) {
	showJson = false
	void bus.uiEvent('ui', actor.uuid, {
		send: 'SHOW_STEP',
		payload: { index: row.index === viewStep ? -1 : row.index }
	})
}
</script>

<div class="flex w-full max-w-3xl flex-col gap-4">
	<div>
		<p class="font-mono text-[0.6875rem] text-foreground/40 uppercase tracking-widest">
			{String(actor.state?.title ?? actor.manifest.name)}
		</p>
		<p class="text-foreground/60 text-sm">{String(actor.state?.note ?? '')}</p>
	</div>

	<!-- The stepper: the whole recipe as one row of chips; done steps tappable. -->
	<div class="flex flex-wrap gap-1.5">
		{#each stepRows as row (row.index)}
			<button
				type="button"
				onclick={() => tap(row)}
				class="flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors
					{row.index === viewStep
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-foreground/10 bg-white/60 text-foreground/70 hover:border-foreground/25'}"
			>
				<span class="font-mono">{row.mark}</span>
				{row.label}
			</button>
		{/each}
	</div>

	{#each goalRows as row (row.quote)}
		<p class="border-foreground/15 border-l-2 pl-3 text-foreground/60 text-sm italic">
			{row.quote}
		</p>
	{/each}

	{#each history as row, i (i)}
		<div class="flex flex-col gap-2 rounded-xl border border-foreground/10 bg-white/60 p-4">
			<p class="text-sm">
				<span
					class="mr-2 rounded-full border border-foreground/15 px-2 py-0.5 font-mono text-[0.6875rem] text-foreground/50"
					>Runde {i + 1}</span
				>
				{row.error}
			</p>
			{#if row.excerpt}
				<pre
					class="max-h-32 overflow-auto rounded-lg bg-foreground/5 p-2 font-mono text-[0.6875rem] whitespace-pre-wrap"
				>{row.excerpt}</pre>
			{/if}
		</div>
	{/each}

	<!-- The active (or tapped) step's OWN face — the step keeps its view. -->
	{#if stepActor}
		{#key stepActor.uuid}
			<AvenUiView actor={stepActor} />
		{/key}
	{/if}

	<!-- The machine truth under the face: the step's parsed JSON record. -->
	{#if stepRecord}
		<div class="flex flex-col gap-2">
			<button
				type="button"
				onclick={() => (showJson = !showJson)}
				class="self-start rounded-full border border-foreground/10 px-2.5 py-1 font-mono text-[0.6875rem] text-foreground/50 transition-colors hover:border-foreground/25"
			>
				{'{ }'}
				{showJson ? 'hide' : 'show'}
				step JSON
			</button>
			{#if showJson}
				<pre
					class="max-h-72 overflow-auto rounded-xl bg-foreground/5 p-3 font-mono text-[0.6875rem] whitespace-pre-wrap"
				>{JSON.stringify(
						stepRecord,
						null,
						2
					)}</pre>
			{/if}
		</div>
	{/if}

	{#if phase === 'staged'}
		<div class="flex gap-2">
			<button
				type="button"
				onclick={() => void bus.uiEvent('ui', actor.uuid, { send: 'PROMOTE' })}
				class="rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm"
			>
				Promote
			</button>
			<button
				type="button"
				onclick={() => void bus.uiEvent('ui', actor.uuid, { send: 'DISCARD' })}
				class="rounded-full border border-foreground/10 px-4 py-1.5 font-medium text-foreground/60 text-sm"
			>
				Discard
			</button>
		</div>
	{/if}

	{#if produced.length > 0}
		<div class="flex flex-col gap-1">
			{#each produced as row, i (i)}
				<p class="font-mono text-foreground/50 text-xs">
					{row.id}
					<span class="ml-2 rounded-full border border-foreground/15 px-2 py-0.5"
						>{row.status}</span
					>
				</p>
			{/each}
		</div>
	{/if}
</div>
